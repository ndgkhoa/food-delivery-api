import type Redis from 'ioredis';
import type { CacheLogger } from './cache-logger';
import type { CacheMetrics } from './cache-metrics';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RedisCache {
  constructor(
    private readonly redis: Redis,
    private readonly metrics: CacheMetrics,
    private readonly logger: CacheLogger,
  ) {}

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

  async writeThrough<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
    } catch (error) {
      this.logger.warn(
        `cache SET failed for "${key}" — continuing uncached: ${describeError(error)}`,
      );
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`cache DEL failed for "${key}": ${describeError(error)}`);
    }
  }

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
