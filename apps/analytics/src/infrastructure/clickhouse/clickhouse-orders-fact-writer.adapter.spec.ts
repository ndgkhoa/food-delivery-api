import { ORDERS_FACT_TABLE } from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import { ClickHouseOrdersFactWriterAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-orders-fact-writer.adapter';
import type { ClickHouseClient } from '@clickhouse/client';

describe('ClickHouseOrdersFactWriterAdapter', () => {
  const insert = jest.fn().mockResolvedValue(undefined);
  const client = { insert } as unknown as ClickHouseClient;

  beforeEach(() => {
    insert.mockClear();
  });

  it('inserts one row into orders_fact via JSONEachRow with snake_case columns', async () => {
    const adapter = new ClickHouseOrdersFactWriterAdapter(client);
    await adapter.write({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      restaurantId: 'restaurant-1',
      userId: 'user-1',
      status: 'CONFIRMED',
      totalCents: 2500,
      occurredAt: new Date('2026-01-15T10:00:00.000Z'),
    });

    expect(insert).toHaveBeenCalledWith({
      table: ORDERS_FACT_TABLE,
      values: [
        {
          tenant_id: 'tenant-1',
          order_id: 'order-1',
          restaurant_id: 'restaurant-1',
          user_id: 'user-1',
          status: 'CONFIRMED',
          total_cents: 2500,
          occurred_at: '2026-01-15T10:00:00.000Z',
        },
      ],
      format: 'JSONEachRow',
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
  });

  it('never supplies ingested_at — the table DEFAULT stamps it so a redelivery gets a fresh version', async () => {
    const adapter = new ClickHouseOrdersFactWriterAdapter(client);
    await adapter.write({
      tenantId: 'tenant-1',
      orderId: 'order-2',
      restaurantId: '',
      userId: 'user-2',
      status: 'CANCELLED',
      totalCents: 500,
      occurredAt: new Date('2026-01-15T10:00:00.000Z'),
    });

    const [[call]] = insert.mock.calls;
    expect(call.values[0]).not.toHaveProperty('ingested_at');
  });
});
