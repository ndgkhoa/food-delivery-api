import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';
import type { RestaurantSearchResult } from '@search/domain/restaurant-search/restaurant-search-document';

/** Validated, bounded query params the controller passes down (tenant is added here). */
export interface SearchRestaurantsParams {
  q: string;
  page: number;
  limit: number;
}

/**
 * Full-text restaurant search over the ES read model, scoped to the caller's
 * tenant. The tenant id comes from the trusted identity the gateway verified and
 * propagated (never a raw client header), so results can never leak across
 * tenants.
 */
@Injectable()
export class SearchRestaurantsHandler {
  constructor(
    @Inject(RESTAURANT_SEARCH_REPOSITORY)
    private readonly repository: RestaurantSearchRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  execute(params: SearchRestaurantsParams): Promise<RestaurantSearchResult> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.repository.search({ tenantId, ...params });
  }
}
