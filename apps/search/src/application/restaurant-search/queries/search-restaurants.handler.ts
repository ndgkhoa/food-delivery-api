import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';
import type { RestaurantSearchResult } from '@search/domain/restaurant-search/restaurant-search-document';

export interface SearchRestaurantsParams {
  q: string;
  page: number;
  limit: number;
}

const MAX_RESULT_WINDOW = 10_000;

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
