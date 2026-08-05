import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { LockContentionError } from './errors';
import { RedisDistributedLock } from './redis-distributed-lock';

class FakeRedis {
  status = 'ready';
  private readonly store = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  readonly setKeyOrder: string[] = [];

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async pexpire(_key: string, _ttlMs: number): Promise<number> {
    return 1;
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

  forceExpire(key: string): void {
    this.store.delete(key);
  }
}

class ThrowingEvalRedis extends FakeRedis {
  override async eval(): Promise<number> {
    throw new Error('redis connection reset');
  }
}

function buildLock(
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
      const { lock } = buildLock();

      const first = await lock.acquire('k', ttl);
      const second = await lock.acquire('k', ttl);

      expect(first).toBe('1');
      expect(second).toBeNull();
    });

    it('issues strictly increasing fencing tokens across acquisitions', async () => {
      const { lock } = buildLock();

      const first = await lock.acquire('k', ttl);
      await lock.release('k', first as string);
      const second = await lock.acquire('k', ttl);

      expect(Number(second)).toBeGreaterThan(Number(first));
    });

    it('only lets the token holder release (compare-and-del)', async () => {
      const { lock, redis } = buildLock();
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
      const { lock, redis } = buildLock();

      await lock.withLocks(['item-c', 'item-a', 'item-b'], ttl, async () => undefined);

      expect(redis.setKeyOrder).toEqual(['item-a', 'item-b', 'item-c']);
    });

    it('runs the callback with all locks held and releases them afterwards', async () => {
      const { lock, redis } = buildLock();
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
      const { lock, redis } = buildLock(60, 10);
      await lock.acquire('b', ttl);

      await expect(lock.withLocks(['a', 'b'], ttl, async () => 'never')).rejects.toBeInstanceOf(
        LockContentionError,
      );

      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(true);
    });

    it('waits for a contended key and proceeds once it is released within the budget', async () => {
      const { lock, redis } = buildLock(1000, 10);
      const heldToken = (await lock.acquire('b', ttl)) as string;
      setTimeout(() => {
        void lock.release('b', heldToken);
      }, 30);

      const result = await lock.withLocks(['a', 'b'], ttl, async () => 'proceeded');

      expect(result).toBe('proceeded');
      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(false);
    });

    it('releases locks even when the callback throws', async () => {
      const { lock, redis } = buildLock();

      await expect(
        lock.withLocks(['a', 'b'], ttl, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(redis.has('a')).toBe(false);
      expect(redis.has('b')).toBe(false);
    });

    it('warns instead of throwing when a held lock already expired before release', async () => {
      const { lock, redis } = buildLock();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await lock.withLocks(['a'], ttl, async () => {
        redis.forceExpire('a');
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Lock "a" already expired before this holder released it'),
      );
      warnSpy.mockRestore();
    });

    it('warns and continues when the redis release call itself throws', async () => {
      const redis = new ThrowingEvalRedis();
      const lock = new RedisDistributedLock(redis as unknown as Redis);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await lock.withLocks(['a'], ttl, async () => 'done');

      expect(result).toBe('done');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to release lock "a"; it will expire via TTL'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects the redis client when it is not already ended', () => {
      const { lock, redis } = buildLock();

      lock.onModuleDestroy();

      expect(redis.status).toBe('end');
    });

    it('does nothing when the redis client already ended', () => {
      const { lock, redis } = buildLock();
      redis.disconnect();
      const disconnectSpy = jest.spyOn(redis, 'disconnect');

      lock.onModuleDestroy();

      expect(disconnectSpy).not.toHaveBeenCalled();
    });
  });
});
