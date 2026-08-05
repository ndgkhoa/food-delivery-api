import type { RateLimitResult, RateLimitStore } from '@gateway/rate-limit/rate-limit-store';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  async hit(key: string, windowSec: number): Promise<RateLimitResult> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
      return { count, ttlSec: windowSec };
    }
    let ttlSec = await this.redis.ttl(key);
    if (ttlSec < 0) {
      await this.redis.expire(key, windowSec);
      ttlSec = windowSec;
    }
    return { count, ttlSec };
  }

  onModuleDestroy(): void {
    if (this.redis.status !== 'end') {
      this.redis.disconnect();
    }
  }
}
