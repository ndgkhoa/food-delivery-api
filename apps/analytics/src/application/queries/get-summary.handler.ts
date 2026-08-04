import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  SUMMARY_QUERY,
  type SummaryQueryPort,
  type SummaryResult,
} from '@analytics/domain/analytics-query/summary-query.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

export interface GetSummaryParams {
  from: string;
  to: string;
}

@Injectable()
export class GetSummaryHandler {
  constructor(
    @Inject(SUMMARY_QUERY) private readonly query: SummaryQueryPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(params: GetSummaryParams): Promise<SummaryResult> {
    const range = parseDateRangeOrThrow(params.from, params.to);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.query.query({ tenantId, range });
  }
}
