import { LocationRateLimiter } from '@delivery/interface/ws/location-rate-limiter';

describe('LocationRateLimiter', () => {
  it('allows up to maxPerSec pushes within one window, then drops', () => {
    const limiter = new LocationRateLimiter(3);
    expect(limiter.allow(1000)).toBe(true);
    expect(limiter.allow(1100)).toBe(true);
    expect(limiter.allow(1200)).toBe(true);
    expect(limiter.allow(1300)).toBe(false);
    expect(limiter.allow(1900)).toBe(false);
  });

  it('resets once the one-second window rolls over', () => {
    const limiter = new LocationRateLimiter(2);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(500)).toBe(true);
    expect(limiter.allow(600)).toBe(false);
    expect(limiter.allow(1000)).toBe(true);
    expect(limiter.allow(1200)).toBe(true);
    expect(limiter.allow(1300)).toBe(false);
  });
});
