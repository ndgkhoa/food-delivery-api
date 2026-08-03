import type {
  SummaryQuery,
  SummaryQueryPort,
  SummaryResult,
} from '@analytics/domain/analytics-query/summary-query.port';
import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject, Injectable } from '@nestjs/common';

/** ClickHouse returns Int64/UInt64 aggregates as strings over JSONEachRow (avoids JS number precision loss). */
interface SummaryRow {
  revenue_cents: string;
  confirmed_count: string;
  cancelled_count: string;
}

/**
 * A single aggregate row (no `GROUP BY`) always comes back even when zero
 * rows match the filter — `sumIf`/`countIf` default to 0, never NULL. `FINAL`
 * keeps this merge-independent; `{tenant}`/`{from}`/`{to}` are always bound
 * via `query_params`, never string-interpolated.
 */
const QUERY = `
  SELECT
    sumIf(total_cents, status = 'CONFIRMED') AS revenue_cents,
    countIf(status = 'CONFIRMED') AS confirmed_count,
    countIf(status = 'CANCELLED') AS cancelled_count
  FROM ${ORDERS_FACT_TABLE} FINAL
  WHERE tenant_id = {tenant:String}
    AND occurred_at >= {from:DateTime64(3)}
    AND occurred_at <= {to:DateTime64(3)}
`;

@Injectable()
export class ClickHouseSummaryQueryAdapter implements SummaryQueryPort {
  constructor(@Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient) {}

  async query(input: SummaryQuery): Promise<SummaryResult> {
    const resultSet = await this.client.query({
      query: QUERY,
      format: 'JSONEachRow',
      query_params: { tenant: input.tenantId, from: input.range.from, to: input.range.to },
    });
    const [row] = await resultSet.json<SummaryRow>();
    return {
      revenueCents: Number(row?.revenue_cents ?? 0),
      confirmedCount: Number(row?.confirmed_count ?? 0),
      cancelledCount: Number(row?.cancelled_count ?? 0),
    };
  }
}
