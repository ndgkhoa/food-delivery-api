import { ClickHouseTopRestaurantsQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-top-restaurants-query.adapter';
import type { ClickHouseClient } from '@clickhouse/client';

describe('ClickHouseTopRestaurantsQueryAdapter', () => {
  const json = jest
    .fn()
    .mockResolvedValue([
      { restaurant_id: 'restaurant-1', revenue_cents: '5000', order_count: '10' },
    ]);
  const query = jest.fn().mockResolvedValue({ json });
  const client = { query } as unknown as ClickHouseClient;

  beforeEach(() => {
    json.mockClear();
    query.mockClear();
  });

  it('binds tenant/from/to/limit via query_params and excludes unattributed rows', async () => {
    const adapter = new ClickHouseTopRestaurantsQueryAdapter(client);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');

    await adapter.query({ tenantId: 'tenant-1', range: { from, to }, limit: 5 });

    const [[call]] = query.mock.calls;
    expect(call.query).toContain("restaurant_id != ''");
    expect(call.query).toContain('{limit:UInt32}');
    expect(call.query).not.toContain('tenant-1');
    expect(call.query_params).toEqual({ tenant: 'tenant-1', from, to, limit: 5 });
  });

  it('maps the stringified Int64/UInt64 aggregates into numbers', async () => {
    const adapter = new ClickHouseTopRestaurantsQueryAdapter(client);
    const result = await adapter.query({
      tenantId: 'tenant-1',
      range: { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
      limit: 5,
    });

    expect(result).toEqual([{ restaurantId: 'restaurant-1', revenueCents: 5000, orderCount: 10 }]);
  });
});
