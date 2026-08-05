import { SKIP_RATE_LIMIT_KEY, SkipRateLimit } from '@gateway/rate-limit/skip-rate-limit.decorator';
import { Reflector } from '@nestjs/core';

class SampleController {
  @SkipRateLimit()
  handler(): void {}
}

@SkipRateLimit()
class DecoratedController {}

describe('SkipRateLimit', () => {
  it('flags a decorated method with the skip-rate-limit metadata key', () => {
    const reflector = new Reflector();

    expect(reflector.get(SKIP_RATE_LIMIT_KEY, SampleController.prototype.handler)).toBe(true);
  });

  it('flags a decorated class with the skip-rate-limit metadata key', () => {
    const reflector = new Reflector();

    expect(reflector.get(SKIP_RATE_LIMIT_KEY, DecoratedController)).toBe(true);
  });

  it('leaves an undecorated method without the skip-rate-limit metadata key', () => {
    class PlainController {
      handler(): void {}
    }
    const reflector = new Reflector();

    expect(reflector.get(SKIP_RATE_LIMIT_KEY, PlainController.prototype.handler)).toBeUndefined();
  });
});
