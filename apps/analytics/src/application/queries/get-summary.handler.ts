import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  SUMMARY_QUERY,
  type SummaryQueryPort,
  type SummaryResult,
} from '@analytics/domain/analytics-query/summary-query.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

/** Validated, bounded query params the controller passes down (tenant is added here). */
export interface GetSummaryParams {
  from: string;
  to: string;
}

/**
 * Tenant-wide summary dashboard: total revenue plus confirmed/cancelled order
 * counts over the date range, scoped to the caller's tenant.
 */
@Injectable()
export class GetSummaryHandler {
  constructor(
    @Inject(SUMMARY_QUERY) private readonly query: SummaryQueryPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  // async so a synchronous validation throw (invalid/inverted range) becomes a
  // rejected promise, not an exception thrown out of the call itself.
  async execute(params: GetSummaryParams): Promise<SummaryResult> {
    const range = parseDateRangeOrThrow(params.from, params.to);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.query.query({ tenantId, range });
  }
}
