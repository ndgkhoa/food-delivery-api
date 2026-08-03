/**
 * Port for a TTL-bounded distributed mutex. Callers depend on this interface +
 * token, never on the Redis adapter — so the lock stays swappable and the
 * consuming application layer never imports infrastructure.
 */
export interface DistributedLock {
  /**
   * Attempts to grab `key` for at most `ttlMs`. Returns a monotonic fencing
   * token on success (pass it to {@link release} so only the holder can free
   * the lock), or `null` when another holder currently owns the key.
   */
  acquire(key: string, ttlMs: number): Promise<string | null>;

  /**
   * Releases `key` only if `token` still matches the current holder
   * (compare-and-delete). Returns true if this call freed the lock, false if
   * the token no longer matched (e.g. the TTL had already expired it).
   */
  release(key: string, token: string): Promise<boolean>;

  /**
   * Acquires every key in deterministic sorted order (so concurrent multi-key
   * callers can never deadlock), runs `fn`, then releases in reverse order —
   * always, even if `fn` throws. Throws `LockContentionError` if any key is
   * already held, after releasing any it did grab.
   */
  withLocks<T>(keys: string[], ttlMs: number, fn: () => Promise<T>): Promise<T>;
}

export const DISTRIBUTED_LOCK = Symbol('DistributedLock');
