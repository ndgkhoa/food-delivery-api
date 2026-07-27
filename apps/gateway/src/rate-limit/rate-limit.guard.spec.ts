import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import { RateLimitGuard } from '@gateway/rate-limit/rate-limit.guard';
import type { RateLimitStore } from '@gateway/rate-limit/rate-limit-store';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX = 3;
const WINDOW_SEC = 60;

function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_MAX: MAX,
    RATE_LIMIT_WINDOW_SEC: WINDOW_SEC,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

function contextFor(request: Partial<AuthenticatedRequest>): {
  context: ExecutionContext;
  setHeader: jest.Mock;
} {
  const setHeader = jest.fn();
  const req = { headers: {}, ...request } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

describe('RateLimitGuard', () => {
  let store: jest.Mocked<RateLimitStore>;

  beforeEach(() => {
    store = { hit: jest.fn() };
  });

  it('keys by the verified sub when authenticated and allows under the limit', async () => {
    store.hit.mockResolvedValue({ count: MAX, ttlSec: WINDOW_SEC });
    const guard = new RateLimitGuard(store, configStub());
    const { context } = contextFor({ identity: { sub: 'user-1', tenantId: 't', roles: [] } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(store.hit).toHaveBeenCalledWith('rl:sub:user-1', WINDOW_SEC);
  });

  it('falls back to the client IP when unauthenticated', async () => {
    store.hit.mockResolvedValue({ count: 1, ttlSec: WINDOW_SEC });
    const guard = new RateLimitGuard(store, configStub());
    const { context } = contextFor({ ip: '10.0.0.9' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(store.hit).toHaveBeenCalledWith('rl:ip:10.0.0.9', WINDOW_SEC);
  });

  it('rejects with 429 + Retry-After once over the limit', async () => {
    store.hit.mockResolvedValue({ count: MAX + 1, ttlSec: 42 });
    const guard = new RateLimitGuard(store, configStub());
    const { context, setHeader } = contextFor({
      identity: { sub: 'user-1', tenantId: 't', roles: [] },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');

    try {
      await guard.canActivate(context);
      fail('expected the guard to throw');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('short-circuits (never touches the store) when disabled', async () => {
    const guard = new RateLimitGuard(store, configStub({ RATE_LIMIT_ENABLED: false }));
    const { context } = contextFor({ ip: '10.0.0.9' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(store.hit).not.toHaveBeenCalled();
  });
});
