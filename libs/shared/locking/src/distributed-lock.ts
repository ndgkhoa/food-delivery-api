export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<string | null>;

  release(key: string, token: string): Promise<boolean>;

  withLocks<T>(keys: string[], ttlMs: number, fn: () => Promise<T>): Promise<T>;
}

export const DISTRIBUTED_LOCK = Symbol('DistributedLock');
