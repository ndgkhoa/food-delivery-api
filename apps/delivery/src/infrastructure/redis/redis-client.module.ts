import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Wraps a single ioredis client (the `core`-profile Redis at REDIS_URL) in a
 * Nest provider — the GEO driver-location store and the assignment store share
 * it. `maxRetriesPerRequest: null` keeps a command from failing fast during a
 * brief Redis blip (mirrors the shared locking client). The connection is quit
 * on shutdown so a redeploy drains cleanly.
 */
const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService): Redis =>
    new Redis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null }),
  inject: [ConfigService],
};

@Module({
  providers: [redisClientProvider],
  exports: [REDIS_CLIENT],
})
export class RedisClientModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}
