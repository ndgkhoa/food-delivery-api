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
