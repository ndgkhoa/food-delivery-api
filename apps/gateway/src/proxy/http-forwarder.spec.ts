import type { AuthenticatedRequest } from '@gateway/guards/authenticated-request';
import type { CircuitBreakerRegistry } from '@gateway/proxy/circuit-breaker.registry';
import type { ForwardTarget } from '@gateway/proxy/http-forwarder';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import type { Response as ExpressResponse } from 'express';

const TARGET: ForwardTarget = {
  gatewayPrefix: '/api/v1/catalog',
  baseUrl: 'http://catalog.internal:3001',
  serviceName: 'catalog',
};

function reqStub(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    identity: { sub: 'user-1', tenantId: 'tenant-1', roles: [] },
    originalUrl: '/api/v1/catalog/restaurants',
    method: 'GET',
    headers: {},
    body: undefined,
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function resStub(): { res: ExpressResponse; state: Record<string, unknown> } {
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
function breakersStub(run: jest.Mock): CircuitBreakerRegistry {
  return { run, resetTimeoutMs: 10_000 } as unknown as CircuitBreakerRegistry;
}

describe('HttpForwarder', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps an EOPENBREAKER rejection to 503 + Retry-After without ever calling fetch', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const openError = Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' });
    const run = jest.fn().mockRejectedValue(openError);
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(503);
    expect((state.headers as Record<string, string>)['Retry-After']).toBe('10');
    expect(state.body).toEqual({ statusCode: 503, message: 'Service temporarily unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('catalog', expect.any(Function));
  });

  it('maps an AbortError rejection to 504', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const run = jest.fn().mockRejectedValue(abortError);
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(504);
    expect(state.body).toEqual({ statusCode: 504, message: 'Upstream timed out' });
  });

  it('maps any other rejection (network error) to 502', async () => {
    const run = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(502);
    expect(state.body).toEqual({ statusCode: 502, message: 'Bad gateway' });
  });

  it('relays a resolved 5xx upstream response through unchanged (does not trip the breaker path)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(500);
    expect(Buffer.from(state.sent as Buffer).toString()).toContain('boom');
  });

  it('relays a resolved 2xx upstream response through unchanged', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ) as unknown as typeof fetch;
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(200);
    expect(Buffer.from(state.sent as Buffer).toString()).toBe(JSON.stringify({ data: [] }));
  });

  it('maps a stalled/aborted body read to 504 and never half-writes the response', async () => {
    // undici resolves fetch on headers; the body read is what stalls. The action
    // reads the body under the abort timeout, so an aborted body rejects the
    // action → the breaker counts a failure (via pass-through run here) → 504,
    // and nothing was written to res before the failure.
    const upstream = {
      status: 200,
      headers: new Headers(),
      arrayBuffer: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        ),
    };
    global.fetch = jest.fn().mockResolvedValue(upstream) as unknown as typeof fetch;
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(504);
    expect(state.body).toEqual({ statusCode: 504, message: 'Upstream timed out' });
    expect(state.sent).toBeUndefined();
  });

  it('runs the breaker action through the real fetch and forwards the target URL', async () => {
    const upstream = new Response('ok', { status: 200 });
    const fetchSpy = jest.fn().mockResolvedValue(upstream);
    global.fetch = fetchSpy as unknown as typeof fetch;
    // Pass-through run: invokes the action exactly as CircuitBreakerRegistry would when disabled.
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run));
    const { res } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://catalog.internal:3001/api/v1/restaurants',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
