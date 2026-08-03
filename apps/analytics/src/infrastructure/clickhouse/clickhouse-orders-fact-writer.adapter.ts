import type { OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';
import type { OrdersFactWriterPort } from '@analytics/domain/orders-fact/orders-fact-writer.port';
import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject, Injectable } from '@nestjs/common';

/** The wire shape `orders_fact` expects — snake_case ClickHouse columns mapped from the domain's camelCase row. */
interface OrdersFactInsertRow {
  tenant_id: string;
  order_id: string;
  restaurant_id: string;
  user_id: string;
  status: string;
  total_cents: number;
  occurred_at: string;
}

/**
 * Appends one `orders_fact` row per call — never updates or deletes.
 * `ingested_at` is deliberately omitted from the insert so the table's own
 * `DEFAULT now64(3)` stamps it: a redelivery of the same order gets a FRESH
 * (later) `ingested_at`, which is exactly the ReplacingMergeTree version that
 * makes it win the merge over the earlier insert.
 */
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
      // Accepts the ISO-8601 string above for the DateTime64 column without
      // requiring a hand-rolled "YYYY-MM-DD HH:MM:SS.sss" formatter.
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
  }
}
