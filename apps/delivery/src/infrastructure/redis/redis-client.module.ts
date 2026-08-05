import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
