import type { OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';
import type { OrdersFactWriterPort } from '@analytics/domain/orders-fact/orders-fact-writer.port';
import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject, Injectable } from '@nestjs/common';

interface OrdersFactInsertRow {
  tenant_id: string;
  order_id: string;
  restaurant_id: string;
  user_id: string;
  status: string;
  total_cents: number;
  occurred_at: string;
}

@Injectable()
export class ClickHouseOrdersFactWriterAdapter implements OrdersFactWriterPort {
  constructor(@Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient) {}

  async write(row: OrdersFactRow): Promise<void> {
    const values: OrdersFactInsertRow = {
      tenant_id: row.tenantId,
      order_id: row.orderId,
      restaurant_id: row.restaurantId,
      user_id: row.userId,
      status: row.status,
      total_cents: row.totalCents,
      occurred_at: row.occurredAt.toISOString(),
    };
    await this.client.insert({
      table: ORDERS_FACT_TABLE,
      values: [values],
      format: 'JSONEachRow',
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
  }
}
