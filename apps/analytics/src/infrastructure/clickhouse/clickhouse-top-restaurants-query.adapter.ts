import type {
  TopRestaurantEntry,
  TopRestaurantsQuery,
  TopRestaurantsQueryPort,
} from '@analytics/domain/analytics-query/top-restaurants-query.port';
import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject, Injectable } from '@nestjs/common';

/** ClickHouse returns Int64/UInt64 aggregates as strings over JSONEachRow (avoids JS number precision loss). */
interface TopRestaurantRow {
  restaurant_id: string;
  revenue_cents: string;
  order_count: string;
}

/**
 * `restaurant_id != ''` excludes a straggler order confirmed without a
 * restaurant attribution — it's still a real order (counted in revenue and
 * summary), just not attributable to any one restaurant here. `FINAL` keeps
 * this merge-independent; `{tenant}`/`{from}`/`{to}`/`{limit}` are always
 * bound via `query_params`, never string-interpolated.
 */
const QUERY = `
  SELECT
    restaurant_id,
    sum(total_cents) AS revenue_cents,
    count() AS order_count
  FROM ${ORDERS_FACT_TABLE} FINAL
  WHERE tenant_id = {tenant:String}
    AND status = 'CONFIRMED'
    AND restaurant_id != ''
    AND occurred_at >= {from:DateTime64(3)}
    AND occurred_at <= {to:DateTime64(3)}
  GROUP BY restaurant_id
  ORDER BY revenue_cents DESC
  LIMIT {limit:UInt32}
`;

@Injectable()
export class ClickHouseTopRestaurantsQueryAdapter implements TopRestaurantsQueryPort {
  constructor(@Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient) {}

  async query(input: TopRestaurantsQuery): Promise<TopRestaurantEntry[]> {
    const resultSet = await this.client.query({
      query: QUERY,
      format: 'JSONEachRow',
      query_params: {
        tenant: input.tenantId,
        from: input.range.from,
        to: input.range.to,
        limit: input.limit,
      },
    });
    const rows = await resultSet.json<TopRestaurantRow>();
    return rows.map((row) => ({
      restaurantId: row.restaurant_id,
      revenueCents: Number(row.revenue_cents),
      orderCount: Number(row.order_count),
    }));
  }
}
