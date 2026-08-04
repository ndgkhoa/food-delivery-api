import type { DateRange } from '@analytics/domain/analytics-query/date-range';

export interface SummaryResult {
  revenueCents: number;
  confirmedCount: number;
  cancelledCount: number;
}

export interface SummaryQuery {
  tenantId: string;
  range: DateRange;
}

export interface SummaryQueryPort {
  query(input: SummaryQuery): Promise<SummaryResult>;
}

export const SUMMARY_QUERY = Symbol('SummaryQueryPort');
