import type Redis from 'ioredis';
import { LockContentionError } from './lock-contention.error';
import { RedisDistributedLock } from './redis-distributed-lock';

/**
 * In-memory Redis stand-in implementing exactly the commands the lock uses,
 * with the same semantics: `SET ... NX` only sets when absent, and `eval`
 * mirrors the compare-and-delete Lua. Keeps the unit test dependency-free while
 * still exercising the real lock logic (fencing, sorted order, holder-only
 * release). TTL expiry is not modelled here — that belongs to integration.
 */
class FakeRedis {
  status = 'ready';
  private readonly store = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  /** Records the order of SET keys so the sorted-acquire order can be asserted. */
  readonly setKeyOrder: string[] = [];

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async set(
    key: string,
    value: string,
    _expiryMode: 'PX',
    _ttlMs: number,
    _setMode: 'NX',
  ): Promise<'OK' | null> {
    this.setKeyOrder.push(key);
    if (this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    return 'OK';
  }

  async eval(_script: string, _numKeys: number, key: string, token: string): Promise<number> {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }

  disconnect(): void {
    this.status = 'end';
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

function makeLock(
  waitTimeoutMs?: number,
  retryDelayMs?: number,
): {
  lock: RedisDistributedLock;
  redis: FakeRedis;
} {
  const redis = new FakeRedis();
  const lock = new RedisDistributedLock(redis as unknown as Redis, waitTimeoutMs, retryDelayMs);
  return { lock, redis };
}

describe('RedisDistributedLock', () => {
  const ttl = 5000;

  describe('acquire / release', () => {
    it('returns a fencing token on success and null when the key is already held', async () => {
      const { lock } = makeLock();

      const first = await lock.acquire('k', ttl);
      const second = await lock.acquire('k', ttl);

      expect(first).toBe('1');
      expect(second).toBeNull();
    });

    it('issues strictly increasing fencing tokens across acquisitions', async () => {
      const { lock } = makeLock();

      const first = await lock.acquire('k', ttl);
      await lock.release('k', first as string);
      const second = await lock.acquire('k', ttl);

      expect(Number(second)).toBeGreaterThan(Number(first));
    });

    it('only lets the token holder release (compare-and-del)', async () => {
      const { lock, redis } = makeLock();
      const token = (await lock.acquire('k', ttl)) as string;

      const releasedByImpostor = await lock.release('k', 'not-the-token');
      expect(releasedByImpostor).toBe(false);
      expect(redis.has('k')).toBe(true);

      const releasedByHolder = await lock.release('k', token);
      expect(releasedByHolder).toBe(true);
      expect(redis.has('k')).toBe(false);
    });
  });

  describe('withLocks', () => {
    it('acquires keys in deterministic sorted order', async () => {
      const { lock, redis } = makeLock();

      await lock.withLocks(['item-c', 'item-a', 'item-b'], ttl, async () => undefined);

      expect(redis.setKeyOrder).toEqual(['item-a', 'item-b', 'item-c']);
    });

    it('runs the callback with all locks held and releases them afterwards', async () => {
      const { lock, redis } = makeLock();
      let heldDuringCallback = false;

      const result = await lock.withLocks(['a', 'b'], ttl, async () => {
        heldDuringCallback = redis.has('a') && redis.has('b');
        return 'done';
      });

      expect(result).toBe('done');
      expect(heldDuringCallback).toBe(true);
      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(false);
    });

    it('blocks then throws when a key stays contended past the wait budget', async () => {
      // Tiny wait budget so the contended acquire gives up quickly.
      const { lock, redis } = makeLock(60, 10);
      // Pre-hold 'b' and never release it → the second acquire can never succeed.
      await lock.acquire('b', ttl);

      await expect(lock.withLocks(['a', 'b'], ttl, async () => 'never')).rejects.toBeInstanceOf(
        LockContentionError,
      );

      // 'a' was grabbed then rolled back; 'b' remains held by the pre-holder.
      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(true);
    });

    it('waits for a contended key and proceeds once it is released within the budget', async () => {
      // Generous budget; the pre-holder releases 'b' shortly after withLocks starts.
      const { lock, redis } = makeLock(1000, 10);
      const heldToken = (await lock.acquire('b', ttl)) as string;
      setTimeout(() => {
        void lock.release('b', heldToken);
      }, 30);

      const result = await lock.withLocks(['a', 'b'], ttl, async () => 'proceeded');

      expect(result).toBe('proceeded');
      // Both locks were acquired, the callback ran, and both were released after.
      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(false);
    });

    it('releases locks even when the callback throws', async () => {
      const { lock, redis } = makeLock();

      await expect(
        lock.withLocks(['a', 'b'], ttl, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(false);
    });
  });
});
