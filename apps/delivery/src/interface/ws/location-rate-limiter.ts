/**
 * Per-socket fixed-window rate limiter for driver location pushes. Each socket
 * owns one instance; `allow()` returns `false` once `maxPerSec` pushes have been
 * accepted in the current one-second window, and resets when the window rolls
 * over. Excess pushes are dropped (never disconnected) so a chatty client is
 * throttled without losing its stream. Pure + clock-injectable → unit-testable.
 */
export class LocationRateLimiter {
  private windowStartMs = 0;
  private count = 0;

  constructor(private readonly maxPerSec: number) {}

  allow(nowMs: number = Date.now()): boolean {
    if (nowMs - this.windowStartMs >= 1000) {
      this.windowStartMs = nowMs;
      this.count = 0;
    }
    if (this.count >= this.maxPerSec) {
      return false;
    }
    this.count += 1;
    return true;
  }
}
