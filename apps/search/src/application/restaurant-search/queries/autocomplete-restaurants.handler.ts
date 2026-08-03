import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';
import type { RestaurantAutocompleteSuggestion } from '@search/domain/restaurant-search/restaurant-search-document';

/** Validated, bounded autocomplete params (tenant is added here from the trusted identity). */
export interface AutocompleteRestaurantsParams {
  q: string;
  limit: number;
}

/**
 * Edge-ngram prefix autocomplete over restaurant names, scoped to the caller's
 * tenant from the trusted identity. Returns a capped list of id + name
 * suggestions.
 */
@Injectable()
export class AutocompleteRestaurantsHandler {
  constructor(
    @Inject(RESTAURANT_SEARCH_REPOSITORY)
    private readonly repository: RestaurantSearchRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  execute(params: AutocompleteRestaurantsParams): Promise<RestaurantAutocompleteSuggestion[]> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    return this.repository.autocomplete({ tenantId, ...params });
  }
}
