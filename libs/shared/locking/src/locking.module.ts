import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DISTRIBUTED_LOCK } from './distributed-lock';
import { RedisDistributedLock } from './redis-distributed-lock';

/**
 * Wires the `DISTRIBUTED_LOCK` port to its Redis adapter, building the ioredis
 * client from `REDIS_URL`. A service imports `LockingModule.forRoot()` and then
 * injects `@Inject(DISTRIBUTED_LOCK)` wherever it needs a mutex.
 */
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
              // maxRetriesPerRequest: null keeps a lock command from failing fast
              // during a brief Redis blip; the lock's own TTL still bounds waits.
              new Redis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null }),
            ),
        },
      ],
      exports: [DISTRIBUTED_LOCK],
    };
  }
}
