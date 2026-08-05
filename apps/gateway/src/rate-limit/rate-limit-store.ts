export interface RateLimitResult {
  count: number;
  ttlSec: number;
}

export interface RateLimitStore {
  hit(key: string, windowSec: number): Promise<RateLimitResult>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');
