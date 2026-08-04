import type { DateRange } from '@analytics/domain/analytics-query/date-range';

export interface RevenueSeriesPoint {
  day: string;
  revenueCents: number;
  orderCount: number;
}

export interface RevenueSeriesQuery {
  tenantId: string;
  range: DateRange;
}

export interface RevenueSeriesQueryPort {
  query(input: RevenueSeriesQuery): Promise<RevenueSeriesPoint[]>;
}

export const REVENUE_SERIES_QUERY = Symbol('RevenueSeriesQueryPort');
