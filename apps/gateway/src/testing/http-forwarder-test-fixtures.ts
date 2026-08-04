import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import type { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import type { ForwardTarget } from '@gateway/proxy/http-forwarder';
import type { ConfigService } from '@nestjs/config';
import type { Response as ExpressResponse } from 'express';

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

export function breakersStub(run: jest.Mock): CircuitBreakerRegistry {
  return { run, resetTimeoutMs: 10_000 } as unknown as CircuitBreakerRegistry;
}

export function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = { ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}
