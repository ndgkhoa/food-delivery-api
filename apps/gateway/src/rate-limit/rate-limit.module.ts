import { RATE_LIMIT_STORE } from '@gateway/rate-limit/rate-limit-store';
import { RedisRateLimitStore } from '@gateway/rate-limit/redis-rate-limit-store';
import { Module } from '@nestjs/common';

@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStore }],
  exports: [RATE_LIMIT_STORE],
})
export class RateLimitModule {}
