import { CACHE_METRICS, type CacheMetrics, type CacheStats } from '@food-delivery-api/shared-cache';
import { Controller, Get, Inject } from '@nestjs/common';

@Controller('internal/cache-stats')
export class CacheStatsController {
  constructor(@Inject(CACHE_METRICS) private readonly metrics: CacheMetrics) {}

  @Get()
  getStats(): CacheStats {
    return this.metrics.snapshot();
  }
}
