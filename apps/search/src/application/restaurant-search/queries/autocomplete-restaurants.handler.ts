import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';
import type { RestaurantAutocompleteSuggestion } from '@search/domain/restaurant-search/restaurant-search-document';

export interface AutocompleteRestaurantsParams {
  q: string;
  limit: number;
}

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
