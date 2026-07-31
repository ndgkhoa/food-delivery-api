export interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
}

/**
 * In-process hit/miss counter feeding the cache's hit-ratio. One instance is
 * shared by every `cacheAside` call through a given `RedisCache`, so the
 * ratio reflects the whole process's cache traffic. Resets on process
 * restart — this is an operational signal, not a durable metric.
 */
export class CacheMetrics {
  private hits = 0;
  private misses = 0;

  recordHit(): void {
    this.hits += 1;
  }

  recordMiss(): void {
    this.misses += 1;
  }

  get hitRatio(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  snapshot(): CacheStats {
    return { hits: this.hits, misses: this.misses, hitRatio: this.hitRatio };
  }
}
