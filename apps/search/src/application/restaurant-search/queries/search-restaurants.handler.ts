import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
 * Elasticsearch's default `index.max_result_window`. `from + size` beyond this
 * makes ES throw, so we reject deep pages with a 400 rather than surfacing a
 * 500 (and deny a cheap deep-pagination DoS lever). Beyond this a cursor
 * (`search_after`) would be the tool — out of scope for this slice.
 */
const MAX_RESULT_WINDOW = 10_000;

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

  async execute(params: SearchRestaurantsParams): Promise<RestaurantSearchResult> {
    if (params.page * params.limit > MAX_RESULT_WINDOW) {
      throw new BadRequestException(
        `page ${params.page} at limit ${params.limit} exceeds the ${MAX_RESULT_WINDOW}-result window`,
      );
    }
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.repository.search({ tenantId, ...params });
  }
}
