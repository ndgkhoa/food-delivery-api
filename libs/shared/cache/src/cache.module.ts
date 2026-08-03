import {
  type DynamicModule,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { CacheMetrics } from './cache-metrics';
import { RedisCache } from './redis-cache';

export interface CacheModuleOptions {
  /** `redis://host:port` of the shared `core` Redis. */
  redisUrl: string;
}

export const REDIS_CACHE = Symbol('RedisCache');
export const CACHE_METRICS = Symbol('CacheMetrics');

/** Closes the ioredis connection on shutdown so a redeploy drains cleanly. */
@Injectable()
class RedisCacheClientLifecycle implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}

/**
 * Nest dynamic module wiring `RedisCache` (+ its hit/miss `CacheMetrics`) to a
 * single ioredis client. Import once per host app via
 * `CacheModule.forRoot({ redisUrl })` and inject `REDIS_CACHE` / `CACHE_METRICS`.
 *
 * The client is tuned so a down/unreachable Redis fails FAST rather than
 * hanging a request: `enableOfflineQueue: false` rejects immediately instead
 * of queueing commands while disconnected, `commandTimeout` bounds an
 * in-flight command, and `maxRetriesPerRequest: 1` caps per-command retries.
 * Combined with `RedisCache`'s never-throw methods, a cache op degrades to
 * "skip the cache" within milliseconds instead of blocking the caller.
 */
@Module({})
export class CacheModule {
  static forRoot(options: CacheModuleOptions): DynamicModule {
    const logger = new Logger('RedisCache');
    const metrics = new CacheMetrics();
    const redis = new Redis(options.redisUrl, {
      enableOfflineQueue: false,
      commandTimeout: 200,
      maxRetriesPerRequest: 1,
    });
    // ioredis emits 'error' on every connection blip; without a listener Node
    // treats it as an unhandled error and crashes the process — a cache that
    // must never be a hard dependency can't allow that. Log-only.
    redis.on('error', (error: Error) => logger.warn(`Redis connection error: ${error.message}`));

    return {
      module: CacheModule,
      providers: [
        { provide: Redis, useValue: redis },
        { provide: CACHE_METRICS, useValue: metrics },
        { provide: REDIS_CACHE, useValue: new RedisCache(redis, metrics, logger) },
        RedisCacheClientLifecycle,
      ],
      exports: [REDIS_CACHE, CACHE_METRICS],
    };
  }
}
