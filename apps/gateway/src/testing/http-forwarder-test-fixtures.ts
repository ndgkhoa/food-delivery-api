import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import type { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import type { ForwardTarget } from '@gateway/proxy/http-forwarder';
import type { ConfigService } from '@nestjs/config';
import type { Response as ExpressResponse } from 'express';

/** Shared test fixtures for `http-forwarder.spec.ts` — kept separate so the spec stays focused on scenarios, not stub plumbing. */

export const TARGET: ForwardTarget = {
  gatewayPrefix: '/api/v1/catalog',
  baseUrl: 'http://catalog.internal:3001',
  serviceName: 'catalog',
};

export function reqStub(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    identity: { sub: 'user-1', tenantId: 'tenant-1', roles: [] },
    originalUrl: '/api/v1/catalog/restaurants',
    method: 'GET',
    headers: {},
    body: undefined,
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

export function resStub(): { res: ExpressResponse; state: Record<string, unknown> } {
  const state: Record<string, unknown> = { headers: {} };
  const res = {
    status: jest.fn(function status(this: unknown, code: number) {
      state.status = code;
      return res;
    }),
    setHeader: jest.fn((key: string, value: string) => {
      (state.headers as Record<string, string>)[key] = value;
    }),
    json: jest.fn((body: unknown) => {
      state.body = body;
    }),
    send: jest.fn((body: unknown) => {
      state.sent = body;
    }),
  } as unknown as ExpressResponse;
  return { res, state };
}

/** Fake registry: `run` is mocked per test to resolve/reject as the scenario needs. */
export function breakersStub(run: jest.Mock): CircuitBreakerRegistry {
  return { run, resetTimeoutMs: 10_000 } as unknown as CircuitBreakerRegistry;
}

/** No `INTERNAL_IDENTITY_SIGNING_KEY` by default — matches every existing test's unsigned expectations. */
export function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = { ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}
