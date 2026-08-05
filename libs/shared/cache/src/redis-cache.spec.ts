import type Redis from 'ioredis';
import type { CacheLogger } from './cache-logger';
import { CacheMetrics } from './cache-metrics';
import { RedisCache } from './redis-cache';

class FakeRedis {
  private readonly store = new Map<string, string>();
  failing = false;

  async get(key: string): Promise<string | null> {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'PX', _ttlMs: number): Promise<'OK'> {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((key) => key.startsWith(prefix));
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

class FakeLogger implements CacheLogger {
  readonly warnings: string[] = [];
  warn(message: string): void {
    this.warnings.push(message);
  }
}

function makeCache(): {
  cache: RedisCache;
  redis: FakeRedis;
  metrics: CacheMetrics;
  logger: FakeLogger;
} {
  const redis = new FakeRedis();
  const metrics = new CacheMetrics();
  const logger = new FakeLogger();
  const cache = new RedisCache(redis as unknown as Redis, metrics, logger);
  return { cache, redis, metrics, logger };
}

describe('RedisCache', () => {
  describe('cacheAside', () => {
    it('on a miss, calls the loader, caches the result, and records a miss', async () => {
      const { cache, redis, metrics } = makeCache();
      const loader = jest.fn().mockResolvedValue({ name: 'Pho 24' });

      const result = await cache.cacheAside('key-1', 1000, loader);

      expect(result).toEqual({ name: 'Pho 24' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.has('key-1')).toBe(true);
      expect(metrics.snapshot()).toEqual({ hits: 0, misses: 1, hitRatio: 0 });
    });

    it('on a hit, never calls the loader and records a hit', async () => {
      const { cache, metrics } = makeCache();
      const loader = jest.fn().mockResolvedValue({ name: 'first' });
      await cache.cacheAside('key-1', 1000, loader);

      const result = await cache.cacheAside('key-1', 1000, loader);

      expect(result).toEqual({ name: 'first' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(metrics.snapshot()).toEqual({ hits: 1, misses: 1, hitRatio: 0.5 });
    });

    it('falls back to the loader (never throws) when Redis GET fails, and does not cache the miss forever', async () => {
      const { cache, redis, logger } = makeCache();
      redis.failing = true;
      const loader = jest.fn().mockResolvedValue({ name: 'from DB' });

      const result = await cache.cacheAside('key-1', 1000, loader);

      expect(result).toEqual({ name: 'from DB' });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(logger.warnings.some((w) => w.includes('GET failed'))).toBe(true);
    });

    it('propagates a loader error (the cache never swallows a real data-layer failure)', async () => {
      const { cache } = makeCache();
      const loader = jest.fn().mockRejectedValue(new Error('DB unreachable'));

      await expect(cache.cacheAside('key-1', 1000, loader)).rejects.toThrow('DB unreachable');
    });
  });

  describe('writeThrough / invalidate', () => {
    it('writeThrough sets a value a subsequent cacheAside reads as a hit', async () => {
      const { cache, metrics } = makeCache();
      await cache.writeThrough('key-1', { name: 'fresh' }, 1000);

      const loader = jest.fn();
      const result = await cache.cacheAside('key-1', 1000, loader);

      expect(result).toEqual({ name: 'fresh' });
      expect(loader).not.toHaveBeenCalled();
      expect(metrics.snapshot().hits).toBe(1);
    });

    it('invalidate evicts a key so the next read is a miss', async () => {
      const { cache, redis } = makeCache();
      await cache.writeThrough('key-1', { name: 'stale' }, 1000);

      await cache.invalidate('key-1');

      expect(redis.has('key-1')).toBe(false);
    });

    it('writeThrough and invalidate never throw when Redis is down', async () => {
      const { cache, redis, logger } = makeCache();
      redis.failing = true;

      await expect(cache.writeThrough('key-1', { name: 'x' }, 1000)).resolves.toBeUndefined();
      await expect(cache.invalidate('key-1')).resolves.toBeUndefined();
      expect(logger.warnings.length).toBeGreaterThan(0);
    });

    it('invalidatePattern evicts every key matching the prefix, never throws when down', async () => {
      const { cache, redis } = makeCache();
      await cache.writeThrough('catalog:restaurants:tenant-a:list:page=1', [], 1000);
      await cache.writeThrough('catalog:restaurants:tenant-a:list:page=2', [], 1000);
      await cache.writeThrough('catalog:restaurants:tenant-b:list:page=1', [], 1000);

      await cache.invalidatePattern('catalog:restaurants:tenant-a:*');

      expect(redis.has('catalog:restaurants:tenant-a:list:page=1')).toBe(false);
      expect(redis.has('catalog:restaurants:tenant-a:list:page=2')).toBe(false);
      expect(redis.has('catalog:restaurants:tenant-b:list:page=1')).toBe(true);

      redis.failing = true;
      await expect(cache.invalidatePattern('catalog:restaurants:*')).resolves.toBeUndefined();
    });
  });

  describe('tenant key namespacing', () => {
    it('two tenants caching under differently-namespaced keys never collide', async () => {
      const { cache } = makeCache();
      await cache.writeThrough('catalog:restaurant:tenant-a:r1', { owner: 'A' }, 1000);
      await cache.writeThrough('catalog:restaurant:tenant-b:r1', { owner: 'B' }, 1000);

      const forA = await cache.cacheAside('catalog:restaurant:tenant-a:r1', 1000, async () => ({
        owner: 'unexpected',
      }));
      const forB = await cache.cacheAside('catalog:restaurant:tenant-b:r1', 1000, async () => ({
        owner: 'unexpected',
      }));

      expect(forA).toEqual({ owner: 'A' });
      expect(forB).toEqual({ owner: 'B' });
    });
  });
});
