import type { DateRange } from '@analytics/domain/analytics-query/date-range';

/** Tenant-wide totals over a date range: revenue plus confirmed/cancelled order counts. */
export interface SummaryResult {
  revenueCents: number;
  confirmedCount: number;
  cancelledCount: number;
}

export interface SummaryQuery {
  tenantId: string;
  range: DateRange;
}

/** Read port for the tenant-wide summary dashboard (totals, no grouping). */
export interface SummaryQueryPort {
  query(input: SummaryQuery): Promise<SummaryResult>;
}

export const SUMMARY_QUERY = Symbol('SummaryQueryPort');
