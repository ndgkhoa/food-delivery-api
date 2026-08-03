import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DistributedLock } from './distributed-lock';
import { LockContentionError } from './errors';

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

/** How long to keep retrying a contended lock before giving up, and the base poll gap. */
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 25;
/**
 * TTL on the fencing-token counter so idle keys don't accumulate forever. It
 * only needs to outlive an in-flight acquisition; correctness never depends on
 * the counter persisting (the DB is the no-oversell backstop), so a reset after
 * an idle period is harmless.
 */
const FENCE_COUNTER_TTL_MS = 3_600_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface HeldLock {
  key: string;
  token: string;
}

/**
 * Redis-backed distributed lock (ioredis). `SET key token NX PX ttl` is the
 * atomic "acquire iff free with an expiry"; the fencing token comes from an
 * `INCR` counter so it strictly increases across acquisitions of the same key.
 * The adapter owns its Redis connection's lifecycle.
 */
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
    // Bound the counter's lifetime so idle keys expire instead of leaking.
    await this.redis.pexpire(fenceKey, FENCE_COUNTER_TTL_MS);
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const freed = await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    return freed === 1;
  }

  async withLocks<T>(keys: string[], ttlMs: number, fn: () => Promise<T>): Promise<T> {
    // Deterministic sorted order (deduped) → concurrent multi-key callers grab
    // shared keys in the same sequence, so a hold-and-wait cycle can't form.
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
      // Couldn't get the whole set: release what we grabbed (never block while
      // holding a subset) and retry the batch, or give up once the budget is out.
      await this.releaseAll(held);
      if (Date.now() >= deadline) {
        throw new LockContentionError(contendedKey);
      }
      await sleep(this.nextDelayMs());
    }
  }

  /**
   * Try to grab every key once, in order. On the first contended key, stop and
   * return what was held so the caller can release it — never block while
   * holding a subset (that would form hold-and-wait cycles and lengthen the
   * critical section).
   */
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

  /** Release in reverse acquisition order; log (never throw) on failure. */
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

  /** Base delay plus up to one delay of jitter, so retriers don't stampede in lockstep. */
  private nextDelayMs(): number {
    return this.retryDelayMs + Math.floor(Math.random() * this.retryDelayMs);
  }

  onModuleDestroy(): void {
    if (this.redis.status !== 'end') {
      this.redis.disconnect();
    }
  }
}
