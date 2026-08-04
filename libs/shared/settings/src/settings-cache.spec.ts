import { buildCacheKey, SettingsCache } from './settings-cache';

describe('SettingsCache', () => {
  it('returns undefined for a miss and the stored value for a hit', () => {
    const cache = new SettingsCache<number>();
    expect(cache.get(buildCacheKey('t1', 'k'))).toBeUndefined();

    cache.set(buildCacheKey('t1', 'k'), 42, 10_000);
    expect(cache.get(buildCacheKey('t1', 'k'))).toBe(42);
  });

  it('expires an entry once its TTL elapses', () => {
    const cache = new SettingsCache<number>();
    cache.set(buildCacheKey('t1', 'k'), 42, -1);
    expect(cache.get(buildCacheKey('t1', 'k'))).toBeUndefined();
  });

  it('evict removes only the given tenant+key entry', () => {
    const cache = new SettingsCache<number>();
    cache.set(buildCacheKey('t1', 'k'), 1, 10_000);
    cache.set(buildCacheKey('t2', 'k'), 2, 10_000);

    cache.evict('t1', 'k');

    expect(cache.get(buildCacheKey('t1', 'k'))).toBeUndefined();
    expect(cache.get(buildCacheKey('t2', 'k'))).toBe(2);
  });

  it('evictAllForKey removes every tenant entry for that key but leaves other keys alone', () => {
    const cache = new SettingsCache<number>();
    cache.set(buildCacheKey('t1', 'k'), 1, 10_000);
    cache.set(buildCacheKey('t2', 'k'), 2, 10_000);
    cache.set(buildCacheKey('t1', 'other'), 3, 10_000);

    cache.evictAllForKey('k');

    expect(cache.get(buildCacheKey('t1', 'k'))).toBeUndefined();
    expect(cache.get(buildCacheKey('t2', 'k'))).toBeUndefined();
    expect(cache.get(buildCacheKey('t1', 'other'))).toBe(3);
  });
});
