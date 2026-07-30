import { IsIn, IsISO8601, IsOptional } from 'class-validator';

/** Only day-bucketed revenue is supported — `order.events` gives no finer natural grain worth a separate rollup yet. */
export type RevenueGranularity = 'day';

/**
 * `GET /analytics/revenue` query params. `from`/`to` accept a date
 * (`YYYY-MM-DD`) or a full ISO-8601 instant; the application handler further
 * validates `from <= to`, which `class-validator` can't express per-field.
 */
export class RevenueQueryRequest {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsIn(['day'])
  granularity: RevenueGranularity = 'day';
}
