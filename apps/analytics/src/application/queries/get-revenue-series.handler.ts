import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  REVENUE_SERIES_QUERY,
  type RevenueSeriesPoint,
  type RevenueSeriesQueryPort,
} from '@analytics/domain/analytics-query/revenue-series-query.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

/** Validated, bounded query params the controller passes down (tenant is added here). */
export interface GetRevenueSeriesParams {
  from: string;
  to: string;
}

/**
 * Revenue-over-time dashboard: CONFIRMED orders bucketed by day, scoped to
 * the caller's tenant from the verified identity — never a raw client header.
 */
@Injectable()
export class GetRevenueSeriesHandler {
  constructor(
    @Inject(REVENUE_SERIES_QUERY) private readonly query: RevenueSeriesQueryPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  // async so a synchronous validation throw (invalid/inverted range) becomes a
  // rejected promise, not an exception thrown out of the call itself — the
  // HTTP layer (and any caller) can uniformly await/catch either failure mode.
  async execute(params: GetRevenueSeriesParams): Promise<RevenueSeriesPoint[]> {
    const range = parseDateRangeOrThrow(params.from, params.to);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.query.query({ tenantId, range });
  }
}
