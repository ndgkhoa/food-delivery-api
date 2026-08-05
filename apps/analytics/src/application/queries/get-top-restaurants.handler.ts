import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  TOP_RESTAURANTS_QUERY,
  type TopRestaurantEntry,
  type TopRestaurantsQueryPort,
} from '@analytics/domain/analytics-query/top-restaurants-query.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

export interface GetTopRestaurantsParams {
  from: string;
  to: string;
  limit: number;
}

@Injectable()
export class GetTopRestaurantsHandler {
  constructor(
    @Inject(TOP_RESTAURANTS_QUERY) private readonly query: TopRestaurantsQueryPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(params: GetTopRestaurantsParams): Promise<TopRestaurantEntry[]> {
    const range = parseDateRangeOrThrow(params.from, params.to);
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.query.query({ tenantId, range, limit: params.limit });
  }
}
