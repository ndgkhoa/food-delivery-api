import {
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  signIdentity,
} from '@food-delivery-api/shared-tenancy';
import { HttpForwarder } from '@gateway/proxy/http-forwarder';
import {
  breakersStub,
  configStub,
  reqStub,
  resStub,
  TARGET,
} from '@gateway/testing/http-forwarder-test-fixtures';

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
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
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
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(504);
    expect(state.body).toEqual({ statusCode: 504, message: 'Upstream timed out' });
  });

  it('maps any other rejection (network error) to 502', async () => {
    const run = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
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
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
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
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
    const { res, state } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(state.status).toBe(200);
    expect(Buffer.from(state.sent as Buffer).toString()).toBe(JSON.stringify({ data: [] }));
  });

  it('maps a stalled/aborted body read to 504 and never half-writes the response', async () => {
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
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
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
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
    const { res } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://catalog.internal:3001/api/v1/restaurants',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('stamps a verifiable identity signature when a signing key is configured', async () => {
    const upstream = new Response('ok', { status: 200 });
    const fetchSpy = jest.fn().mockResolvedValue(upstream);
    global.fetch = fetchSpy as unknown as typeof fetch;
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const key = 'a-test-signing-key-at-least-32-chars-long';
    const forwarder = new HttpForwarder(
      breakersStub(run),
      configStub({ INTERNAL_IDENTITY_SIGNING_KEY: key }),
    );
    const req = reqStub();
    const { res } = resStub();

    await forwarder.forward(req, res, TARGET);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers[IDENTITY_TS_HEADER]).toMatch(/^\d+$/);
    const expectedSig = signIdentity(key, req.identity!, Number(headers[IDENTITY_TS_HEADER]));
    expect(headers[IDENTITY_SIG_HEADER]).toBe(expectedSig);
  });

  it('stamps no signature headers when no signing key is configured (unsigned/local dev)', async () => {
    const upstream = new Response('ok', { status: 200 });
    const fetchSpy = jest.fn().mockResolvedValue(upstream);
    global.fetch = fetchSpy as unknown as typeof fetch;
    const run = jest.fn((_service: string, action: () => Promise<unknown>) => action());
    const forwarder = new HttpForwarder(breakersStub(run), configStub());
    const { res } = resStub();

    await forwarder.forward(reqStub(), res, TARGET);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers[IDENTITY_TS_HEADER]).toBeUndefined();
    expect(headers[IDENTITY_SIG_HEADER]).toBeUndefined();
  });
});
