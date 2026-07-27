import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DistributedLock } from './distributed-lock';
import { LockContentionError } from './lock-contention.error';

/**
 * Compare-and-delete release: only free the key if its value still equals the
 * fencing token we set. A plain `DEL` would let a caller whose lock already
 * expired (and was re-taken by someone else) delete the new holder's lock; this
 * Lua runs get+del atomically so that race is impossible.
 */
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Suffix for the per-key monotonic fencing-token counter. */
function fenceCounterKey(key: string): string {
  return `${key}:fence`;
}

/** How long to keep retrying a contended lock before giving up, and the poll gap. */
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 25;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Redis-backed distributed lock (ioredis). `SET key token NX PX ttl` is the
 * atomic "acquire iff free with an expiry"; the fencing token comes from an
 * `INCR` counter so it strictly increases across acquisitions of the same key.
 * The adapter owns its Redis connection's lifecycle.
 */
@Injectable()
export class RedisDistributedLock implements DistributedLock, OnModuleDestroy {
  constructor(
    private readonly redis: Redis,
    private readonly waitTimeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
    private readonly retryDelayMs: number = DEFAULT_RETRY_DELAY_MS,
  ) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = String(await this.redis.incr(fenceCounterKey(key)));
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Blocking acquire: a contended reserve critical section must SERIALIZE — each
   * caller waits its turn rather than failing fast — so that under N concurrent
   * reserves exactly `available` succeed and the rest hit out-of-stock, never
   * oversell. Polls with a short backoff until acquired or the wait budget ends.
   */
  private async acquireBlocking(key: string, ttlMs: number): Promise<string> {
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const token = await this.acquire(key, ttlMs);
      if (token !== null) {
        return token;
      }
      if (Date.now() >= deadline) {
        throw new LockContentionError(key);
      }
      await sleep(this.retryDelayMs);
    }
  }

  async release(key: string, token: string): Promise<boolean> {
    const freed = await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    return freed === 1;
  }

  async withLocks<T>(keys: string[], ttlMs: number, fn: () => Promise<T>): Promise<T> {
    // Deterministic sorted order (deduped) → concurrent multi-key callers grab
    // shared keys in the same sequence, so a hold-and-wait cycle can't form.
    const ordered = [...new Set(keys)].sort();
    const held: Array<{ key: string; token: string }> = [];

    try {
      for (const key of ordered) {
        const token = await this.acquireBlocking(key, ttlMs);
        held.push({ key, token });
      }
      return await fn();
    } finally {
      // Release in reverse acquisition order; swallow release failures so the
      // original result/error (not a cleanup hiccup) is what propagates.
      for (const { key, token } of held.reverse()) {
        await this.release(key, token).catch(() => undefined);
      }
    }
  }

  onModuleDestroy(): void {
    if (this.redis.status !== 'end') {
      this.redis.disconnect();
    }
  }
}
