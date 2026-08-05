export function buildCacheKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

interface CacheRecord<TValue> {
  value: TValue;
  expiresAt: number;
}

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

  evict(tenantId: string, key: string): void {
    this.store.delete(buildCacheKey(tenantId, key));
  }

  evictAllForKey(key: string): void {
    const suffix = `:${key}`;
    for (const cacheKey of this.store.keys()) {
      if (cacheKey.endsWith(suffix)) {
        this.store.delete(cacheKey);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}
