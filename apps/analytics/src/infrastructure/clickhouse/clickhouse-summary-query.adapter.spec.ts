import { ClickHouseSummaryQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-summary-query.adapter';
import type { ClickHouseClient } from '@clickhouse/client';

describe('ClickHouseSummaryQueryAdapter', () => {
  const json = jest.fn();
  const query = jest.fn().mockResolvedValue({ json });
  const client = { query } as unknown as ClickHouseClient;

  beforeEach(() => {
    json.mockClear();
    query.mockClear();
  });

  it('binds tenant/from/to via query_params, never string-interpolated', async () => {
    json.mockResolvedValue([
      { revenue_cents: '10000', confirmed_count: '4', cancelled_count: '1' },
    ]);
    const adapter = new ClickHouseSummaryQueryAdapter(client);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');

    const result = await adapter.query({ tenantId: 'tenant-1', range: { from, to } });

    const [[call]] = query.mock.calls;
    expect(call.query).not.toContain('tenant-1');
    expect(call.query_params).toEqual({ tenant: 'tenant-1', from, to });
    expect(result).toEqual({ revenueCents: 10_000, confirmedCount: 4, cancelledCount: 1 });
  });

  it('defaults to zeroes when the aggregate query returns no row', async () => {
    json.mockResolvedValue([]);
    const adapter = new ClickHouseSummaryQueryAdapter(client);

    const result = await adapter.query({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
    });

    expect(result).toEqual({ revenueCents: 0, confirmedCount: 0, cancelledCount: 0 });
  });
});
