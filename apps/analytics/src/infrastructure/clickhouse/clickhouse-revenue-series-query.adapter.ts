import type {
  RevenueSeriesPoint,
  RevenueSeriesQuery,
  RevenueSeriesQueryPort,
} from '@analytics/domain/analytics-query/revenue-series-query.port';
import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject, Injectable } from '@nestjs/common';

/** ClickHouse returns Int64/UInt64 aggregates as strings over JSONEachRow (avoids JS number precision loss). */
interface RevenueSeriesRow {
  day: string;
  revenue_cents: string;
  order_count: string;
}

/**
 * `FINAL` forces the merge to happen at read time, so a not-yet-merged
 * redelivery duplicate is never double-counted — correctness over the
 * (still sub-second, single-node) extra merge cost. `{tenant}`/`{from}`/`{to}`
 * are always bound via `query_params`, never string-interpolated.
 */
const QUERY = `
  SELECT
    toDate(occurred_at) AS day,
    sum(total_cents) AS revenue_cents,
    count() AS order_count
  FROM ${ORDERS_FACT_TABLE} FINAL
  WHERE tenant_id = {tenant:String}
    AND status = 'CONFIRMED'
    AND occurred_at >= {from:DateTime64(3)}
    AND occurred_at <= {to:DateTime64(3)}
  GROUP BY day
  ORDER BY day
`;

@Injectable()
export class ClickHouseRevenueSeriesQueryAdapter implements RevenueSeriesQueryPort {
  constructor(@Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient) {}

  async query(input: RevenueSeriesQuery): Promise<RevenueSeriesPoint[]> {
    const resultSet = await this.client.query({
      query: QUERY,
      format: 'JSONEachRow',
      query_params: { tenant: input.tenantId, from: input.range.from, to: input.range.to },
    });
    const rows = await resultSet.json<RevenueSeriesRow>();
    return rows.map((row) => ({
      day: row.day,
      revenueCents: Number(row.revenue_cents),
      orderCount: Number(row.order_count),
    }));
  }
}
