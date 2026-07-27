import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { RateLimitResult, RateLimitStore } from './rate-limit-store';

/**
 * Redis-backed fixed-window counter. `INCR` gives an atomic per-identity count;
 * the first hit of a new window stamps the TTL so the window (and the count)
 * expire together. Chosen over `@nestjs/throttler` + a storage plugin because a
 * two-command counter needs no extra abstraction and matches the fetch/ioredis
 * "thin adapter" pattern used elsewhere in the repo.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    // lazyConnect: the socket opens on the FIRST command, so booting the gateway
    // (and any suite that never trips the limiter) never blocks on or requires a
    // reachable Redis.
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  async hit(key: string, windowSec: number): Promise<RateLimitResult> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      // Fresh window — arm the expiry once so subsequent hits share it.
      await this.redis.expire(key, windowSec);
      return { count, ttlSec: windowSec };
    }
    let ttlSec = await this.redis.ttl(key);
    if (ttlSec < 0) {
      // Counter exists without a TTL (e.g. a crash between INCR and EXPIRE) —
      // re-arm it so an identity can never be locked out permanently.
      await this.redis.expire(key, windowSec);
      ttlSec = windowSec;
    }
    return { count, ttlSec };
  }

  onModuleDestroy(): void {
    // Synchronous close that is safe whether or not lazyConnect ever opened the
    // socket — avoids a hung handle keeping the process (or a test) alive.
    if (this.redis.status !== 'end') {
      this.redis.disconnect();
    }
  }
}
