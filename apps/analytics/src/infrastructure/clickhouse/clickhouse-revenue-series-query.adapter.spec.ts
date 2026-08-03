import { ClickHouseRevenueSeriesQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-revenue-series-query.adapter';
import type { ClickHouseClient } from '@clickhouse/client';

describe('ClickHouseRevenueSeriesQueryAdapter', () => {
  const json = jest
    .fn()
    .mockResolvedValue([{ day: '2026-01-01', revenue_cents: '2500', order_count: '2' }]);
  const query = jest.fn().mockResolvedValue({ json });
  const client = { query } as unknown as ClickHouseClient;

  beforeEach(() => {
    json.mockClear();
    query.mockClear();
  });

  it('binds tenant/from/to via query_params, never string-interpolated, and reads FINAL', async () => {
    const adapter = new ClickHouseRevenueSeriesQueryAdapter(client);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');

    await adapter.query({ tenantId: 'tenant-1', range: { from, to } });

    expect(query).toHaveBeenCalledTimes(1);
    const [[call]] = query.mock.calls;
    expect(call.query).toContain('FROM orders_fact FINAL');
    expect(call.query).toContain('{tenant:String}');
    expect(call.query).toContain('{from:DateTime64(3)}');
    expect(call.query).toContain('{to:DateTime64(3)}');
    // Every dynamic value is bound via query_params, not interpolated into the SQL string.
    expect(call.query).not.toContain('tenant-1');
    expect(call.query_params).toEqual({ tenant: 'tenant-1', from, to });
  });

  it('maps the stringified Int64/UInt64 aggregates into numbers', async () => {
    const adapter = new ClickHouseRevenueSeriesQueryAdapter(client);
    const result = await adapter.query({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
    });

    expect(result).toEqual([{ day: '2026-01-01', revenueCents: 2500, orderCount: 2 }]);
  });
});
