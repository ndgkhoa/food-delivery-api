/** Outcome of counting one request against a fixed window. */
export interface RateLimitResult {
  /** Running request count within the current window (post-increment). */
  count: number;
  /** Seconds until the window resets — surfaced as the 429 `Retry-After`. */
  ttlSec: number;
}

/**
 * Port the rate-limit guard depends on, so the guard is unit-testable against a
 * fake counter and the Redis client stays an infrastructure detail.
 */
export interface RateLimitStore {
  /** Increment the counter for `key` and return the running count + window TTL. */
  hit(key: string, windowSec: number): Promise<RateLimitResult>;
}

/** DI token for the active `RateLimitStore` binding. */
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');
