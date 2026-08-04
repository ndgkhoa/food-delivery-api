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
  redisUrl: string;
}

export const REDIS_CACHE = Symbol('RedisCache');
export const CACHE_METRICS = Symbol('CacheMetrics');

@Injectable()
class RedisCacheClientLifecycle implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}

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
