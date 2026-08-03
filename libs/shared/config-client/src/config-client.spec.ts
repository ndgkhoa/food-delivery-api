import { ConfigCache } from './config-cache';
import { ConfigClient } from './config-client';

function jsonResponse(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe('ConfigClient', () => {
  const tenantId = '33333333-3333-4333-8333-333333333333';
  let fetchMock: jest.Mock;
  let valueCache: ConfigCache<number>;
  let flagCache: ConfigCache<boolean>;
  let warnings: string[];
  let client: ConfigClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    valueCache = new ConfigCache<number>();
    flagCache = new ConfigCache<boolean>();
    warnings = [];
    client = new ConfigClient(
      { configServiceUrl: 'http://config.test', ttlMs: 30_000 },
      valueCache,
      flagCache,
      { warn: (message: string) => warnings.push(message) },
    );
  });

  it('fetches on a cold miss, caches the result, and serves the cache on the next call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { value: 1500 }));

    await expect(client.getInt('order.delivery_fee_cents', tenantId, 999)).resolves.toBe(1500);
    await expect(client.getInt('order.delivery_fee_cents', tenantId, 999)).resolves.toBe(1500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the caller default on a 404 (no value configured) without a warning', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404));

    await expect(client.getInt('missing.key', tenantId, 42)).resolves.toBe(42);
    expect(warnings).toHaveLength(0);
  });

  it('returns the caller default and logs a WARN when the config service is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(client.getInt('order.delivery_fee_cents', tenantId, 42)).resolves.toBe(42);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('order.delivery_fee_cents');
  });

  it('returns the caller default and logs a WARN on a 5xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500));

    await expect(client.getInt('k', tenantId, 7)).resolves.toBe(7);
    expect(warnings).toHaveLength(1);
  });

  it('never throws even when fetch rejects repeatedly', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(client.getInt('k', tenantId, 1)).resolves.toBe(1);
  });

  it('treats a non-numeric value body as corrupt — WARN + default, and does not cache it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: null }))
      .mockResolvedValueOnce(jsonResponse(200, { value: 1500 }));

    await expect(client.getInt('k', tenantId, 99)).resolves.toBe(99);
    expect(warnings).toHaveLength(1);
    // Not cached — the next call re-fetches and gets the now-valid value.
    await expect(client.getInt('k', tenantId, 99)).resolves.toBe(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-boolean flag body as corrupt — WARN + default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: 'yes' }));

    await expect(client.isEnabled('f', tenantId, false)).resolves.toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('resolves feature flags the same way, independent of the value cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: true }));

    await expect(client.isEnabled('new-ui', tenantId, false)).resolves.toBe(true);
    await expect(client.isEnabled('new-ui', tenantId, false)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
