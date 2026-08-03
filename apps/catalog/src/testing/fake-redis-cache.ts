import type { RedisCache } from '@food-delivery-api/shared-cache';

/**
 * In-memory `RedisCache` stand-in for unit tests — no real Redis, no JSON
 * round-trip (call sites already cache JSON-safe snapshots, not domain
 * objects). `RedisCache` is a concrete class with private fields, so this
 * fake is passed to handlers via `as unknown as RedisCache` (same pattern as
 * `FakeRedis` in `libs/shared/locking`'s spec).
 */
export class FakeRedisCache {
  private readonly store = new Map<string, unknown>();
  hits = 0;
  misses = 0;

  async cacheAside<T>(key: string, _ttlMs: number, loader: () => Promise<T>): Promise<T> {
    if (this.store.has(key)) {
      this.hits += 1;
      return this.store.get(key) as T;
    }
    this.misses += 1;
    const value = await loader();
    this.store.set(key, value);
    return value;
  }

  async writeThrough<T>(key: string, value: T, _ttlMs: number): Promise<void> {
    this.store.set(key, value);
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const prefix = pattern.replace(/\*$/, '');
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  asRedisCache(): RedisCache {
    return this as unknown as RedisCache;
  }
}
