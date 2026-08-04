import type Redis from 'ioredis';
import type { CacheLogger } from './cache-logger';
import type { CacheMetrics } from './cache-metrics';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Redis-backed cache-aside / write-through helper. Every method is
 * NEVER-THROW by design: Redis is an optimisation in front of a durable
 * source of truth (Postgres via a repository `loader`), never a hard
 * dependency — a GET/SET/DEL failure (including a down/unreachable Redis) is
 * logged and the caller falls back to the loader (or simply proceeds without
 * having cached anything). Mirrors the never-throw stance of
 * `SettingsClient` in `@food-delivery-api/shared-settings`.
 *
 * Values are JSON-serialised. Callers own tenant-namespacing the key (e.g.
 * `catalog:restaurant:{tenantId}:{id}`) — this class has no tenant concept of
 * its own, so a caller that forgets to namespace a tenant-scoped key would
 * poison the cache across tenants; every call site in this repo MUST build
 * keys via a shared per-service key-builder rather than inline string
 * concatenation.
 */
export class RedisCache {
  constructor(
    private readonly redis: Redis,
    private readonly metrics: CacheMetrics,
    private readonly logger: CacheLogger,
  ) {}

  /**
   * GET `key`: a hit (including a cached `null`/`false`/`0` — anything that
   * round-trips through JSON) counts as a hit and short-circuits `loader`. A
   * miss (absent key OR a Redis error) counts as a miss, runs `loader`, then
   * best-effort writes the result through with `ttlMs` before returning it.
   * `loader` errors propagate — the cache never swallows a real data-layer
   * failure, only its own.
   */
  async cacheAside<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.safeGet<T>(key);
    if (cached !== undefined) {
      this.metrics.recordHit();
      return cached.value;
    }

    this.metrics.recordMiss();
    const value = await loader();
    await this.writeThrough(key, value, ttlMs);
    return value;
  }

  /** Sets the cache to a freshly-known value (e.g. from a projector that just updated the read model). Never throws. */
  async writeThrough<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
    } catch (error) {
      this.logger.warn(
        `cache SET failed for "${key}" — continuing uncached: ${describeError(error)}`,
      );
    }
  }

  /** Evicts one key (e.g. on a delete event). Never throws. */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`cache DEL failed for "${key}": ${describeError(error)}`);
    }
  }

  /**
   * Evicts every key matching a glob `pattern` (e.g. `catalog:restaurants:{tenantId}:*`).
   * Uses `KEYS` — acceptable here because call sites use this sparingly (bulk
   * tenant-scoped invalidation, not a per-request hot path) against a cache
   * instance sized for this service's own hot data, not `SCAN`-scale traffic.
   * Never throws.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.warn(`cache pattern DEL failed for "${pattern}": ${describeError(error)}`);
    }
  }

  /** Returns `{ value }` on a real hit, `undefined` on a miss OR any Redis error — the two are indistinguishable to the caller by design (both fall back to the loader). */
  private async safeGet<T>(key: string): Promise<{ value: T } | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : { value: JSON.parse(raw) as T };
    } catch (error) {
      this.logger.warn(
        `cache GET failed for "${key}" — falling back to loader: ${describeError(error)}`,
      );
      return undefined;
    }
  }
}
