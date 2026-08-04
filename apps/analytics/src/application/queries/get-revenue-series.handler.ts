import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  REVENUE_SERIES_QUERY,
  type RevenueSeriesPoint,
  type RevenueSeriesQueryPort,
} from '@analytics/domain/analytics-query/revenue-series-query.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

export interface GetRevenueSeriesParams {
  from: string;
  to: string;
}

@Injectable()
export class GetRevenueSeriesHandler {
  constructor(
    @Inject(REVENUE_SERIES_QUERY) private readonly query: RevenueSeriesQueryPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(params: GetRevenueSeriesParams): Promise<RevenueSeriesPoint[]> {
    const range = parseDateRangeOrThrow(params.from, params.to);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.query.query({ tenantId, range });
  }
}
