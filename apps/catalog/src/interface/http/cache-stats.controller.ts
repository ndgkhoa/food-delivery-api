import { CACHE_METRICS, type CacheMetrics, type CacheStats } from '@food-delivery-api/shared-cache';
import { Controller, Get, Inject } from '@nestjs/common';

/**
 * Read-only hit-ratio signal for the restaurant cache — the P7 "cache hit
 * ratio measured" success criterion. In-process counters only (reset on
 * restart); a durable/aggregated metric belongs to the P8 observability work.
 */
@Controller('internal/cache-stats')
export class CacheStatsController {
  constructor(@Inject(CACHE_METRICS) private readonly metrics: CacheMetrics) {}

  @Get()
  getStats(): CacheStats {
    return this.metrics.snapshot();
  }
}
