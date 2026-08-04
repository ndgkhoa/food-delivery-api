import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DISTRIBUTED_LOCK } from './distributed-lock';
import { RedisDistributedLock } from './redis-distributed-lock';

@Module({})
export class LockingModule {
  static forRoot(): DynamicModule {
    return {
      module: LockingModule,
      providers: [
        {
          provide: DISTRIBUTED_LOCK,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            new RedisDistributedLock(
              new Redis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null }),
            ),
        },
      ],
      exports: [DISTRIBUTED_LOCK],
    };
  }
}
