/** Builds the cache key a real (never-null) tenant + config key resolve to. */
export function buildCacheKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

interface CacheRecord<TValue> {
  value: TValue;
  expiresAt: number;
}

/**
 * Minimal in-memory read-through TTL cache. Deliberately NOT namespaced per
 * value-type — `SettingsClient` uses one instance for both `getInt` and
 * `isEnabled` results, since a config key and a flag key never collide (the
 * config service itself keeps them in separate tables/routes).
 */
export class SettingsCache<TValue = unknown> {
  private readonly store = new Map<string, CacheRecord<TValue>>();

  get(cacheKey: string): TValue | undefined {
    const record = this.store.get(cacheKey);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt <= Date.now()) {
      this.store.delete(cacheKey);
      return undefined;
    }
    return record.value;
  }

  set(cacheKey: string, value: TValue, ttlMs: number): void {
    this.store.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Evicts one tenant's cached entry for a key — used when that tenant's own override changed. */
  evict(tenantId: string, key: string): void {
    this.store.delete(buildCacheKey(tenantId, key));
  }

  /**
   * Evicts EVERY tenant's cached entry for a key — used when the GLOBAL
   * default changed. The cache has no record of which cached entries were
   * resolved via the global fallback (the HTTP response is just a number), so
   * the only correct move is to drop every tenant's copy of that key; the next
   * read re-fetches and re-resolves.
   */
  evictAllForKey(key: string): void {
    const suffix = `:${key}`;
    for (const cacheKey of this.store.keys()) {
      if (cacheKey.endsWith(suffix)) {
        this.store.delete(cacheKey);
      }
    }
  }

  /** Test/diagnostic helper — number of live (unexpired not checked) entries. */
  get size(): number {
    return this.store.size;
  }
}
