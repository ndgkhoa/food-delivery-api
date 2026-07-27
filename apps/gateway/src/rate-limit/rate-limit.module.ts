import { Module } from '@nestjs/common';
import { RATE_LIMIT_STORE } from './rate-limit-store';
import { RedisRateLimitStore } from './redis-rate-limit-store';

/**
 * Provides the Redis-backed rate-limit store. The `RateLimitGuard` itself is
 * bound globally at the composition root (AppModule) so its APP_GUARD ordering
 * relative to `JwtAuthGuard` stays explicit and deterministic.
 */
@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStore }],
  exports: [RATE_LIMIT_STORE],
})
export class RateLimitModule {}
