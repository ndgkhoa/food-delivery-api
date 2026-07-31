import { CacheMetrics } from './cache-metrics';

describe('CacheMetrics', () => {
  it('reports a zero ratio with no traffic yet', () => {
    const metrics = new CacheMetrics();
    expect(metrics.snapshot()).toEqual({ hits: 0, misses: 0, hitRatio: 0 });
  });

  it('computes hitRatio as hits / (hits + misses)', () => {
    const metrics = new CacheMetrics();
    metrics.recordHit();
    metrics.recordHit();
    metrics.recordHit();
    metrics.recordMiss();

    expect(metrics.snapshot()).toEqual({ hits: 3, misses: 1, hitRatio: 0.75 });
  });

  it('tracks a miss-only stream as a zero ratio', () => {
    const metrics = new CacheMetrics();
    metrics.recordMiss();
    metrics.recordMiss();

    expect(metrics.hitRatio).toBe(0);
  });
});
