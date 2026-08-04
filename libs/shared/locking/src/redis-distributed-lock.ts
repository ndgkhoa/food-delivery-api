import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DistributedLock } from './distributed-lock';
import { LockContentionError } from './errors';

const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function fenceCounterKey(key: string): string {
  return `${key}:fence`;
}

const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 25;
const FENCE_COUNTER_TTL_MS = 3_600_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface HeldLock {
  key: string;
  token: string;
}

@Injectable()
export class RedisDistributedLock implements DistributedLock, OnModuleDestroy {
  private readonly logger = new Logger(RedisDistributedLock.name);

  constructor(
    private readonly redis: Redis,
    private readonly waitTimeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
    private readonly retryDelayMs: number = DEFAULT_RETRY_DELAY_MS,
  ) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const fenceKey = fenceCounterKey(key);
    const token = String(await this.redis.incr(fenceKey));
    await this.redis.pexpire(fenceKey, FENCE_COUNTER_TTL_MS);
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const freed = await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    return freed === 1;
  }

  async withLocks<T>(keys: string[], ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const deadline = Date.now() + this.waitTimeoutMs;

    for (;;) {
      const { held, contendedKey } = await this.tryAcquireAll(ordered, ttlMs);
      if (contendedKey === null) {
        try {
          return await fn();
        } finally {
          await this.releaseAll(held);
        }
      }
      await this.releaseAll(held);
      if (Date.now() >= deadline) {
        throw new LockContentionError(contendedKey);
      }
      await sleep(this.nextDelayMs());
    }
  }

  private async tryAcquireAll(
    ordered: string[],
    ttlMs: number,
  ): Promise<{ held: HeldLock[]; contendedKey: string | null }> {
    const held: HeldLock[] = [];
    for (const key of ordered) {
      const token = await this.acquire(key, ttlMs);
      if (token === null) {
        return { held, contendedKey: key };
      }
      held.push({ key, token });
    }
    return { held, contendedKey: null };
  }

  private async releaseAll(held: HeldLock[]): Promise<void> {
    for (const { key, token } of [...held].reverse()) {
      try {
        const freed = await this.release(key, token);
        if (!freed) {
          this.logger.warn(`Lock "${key}" already expired before this holder released it`);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to release lock "${key}"; it will expire via TTL: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private nextDelayMs(): number {
    return this.retryDelayMs + Math.floor(Math.random() * this.retryDelayMs);
  }

  onModuleDestroy(): void {
    if (this.redis.status !== 'end') {
      this.redis.disconnect();
    }
  }
}
