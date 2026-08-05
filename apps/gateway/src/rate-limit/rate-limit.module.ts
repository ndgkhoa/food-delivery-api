import { Module } from '@nestjs/common';
import { RATE_LIMIT_STORE } from './rate-limit-store';
import { RedisRateLimitStore } from './redis-rate-limit-store';

@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStore }],
  exports: [RATE_LIMIT_STORE],
})
export class RateLimitModule {}
