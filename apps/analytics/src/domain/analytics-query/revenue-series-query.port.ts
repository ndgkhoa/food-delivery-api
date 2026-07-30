import type { DateRange } from '@analytics/domain/analytics-query/date-range';

/** One day's revenue + confirmed-order count bucket in a revenue-series result. */
export interface RevenueSeriesPoint {
  day: string;
  revenueCents: number;
  orderCount: number;
}

export interface RevenueSeriesQuery {
  tenantId: string;
  range: DateRange;
}

/**
 * Read port for the revenue-over-time dashboard: CONFIRMED orders bucketed by
 * day within the caller's tenant and date range.
 */
export interface RevenueSeriesQueryPort {
  query(input: RevenueSeriesQuery): Promise<RevenueSeriesPoint[]>;
}

export const REVENUE_SERIES_QUERY = Symbol('RevenueSeriesQueryPort');
