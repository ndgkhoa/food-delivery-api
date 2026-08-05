import type { TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { BadRequestException } from '@nestjs/common';
import { SearchRestaurantsHandler } from '@search/application/restaurant-search/queries/search-restaurants.handler';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';
import type {
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';

describe('SearchRestaurantsHandler', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let searched: unknown;
  let repository: RestaurantSearchRepository;
  let tenantContext: TenantContextPort;
  let handler: SearchRestaurantsHandler;

  beforeEach(() => {
    searched = undefined;
    repository = {
      async search(query: RestaurantSearchQuery): Promise<RestaurantSearchResult> {
        searched = query;
        return { data: [], total: 0, page: query.page, limit: query.limit };
      },
    } as unknown as RestaurantSearchRepository;
    tenantContext = { getTenantIdOrThrow: () => tenantId } as unknown as TenantContextPort;
    handler = new SearchRestaurantsHandler(repository, tenantContext);
  });

  it('scopes the query to the caller tenant', async () => {
    await handler.execute({ q: 'pho', page: 1, limit: 20 });
    expect(searched).toMatchObject({ tenantId, q: 'pho', page: 1, limit: 20 });
  });

  it('rejects a page deeper than the result window instead of letting ES 5xx', async () => {
    await expect(handler.execute({ q: 'pho', page: 101, limit: 100 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(searched).toBeUndefined();
  });

  it('allows the last in-window page', async () => {
    await handler.execute({ q: 'pho', page: 100, limit: 100 });
    expect(searched).toMatchObject({ page: 100, limit: 100 });
  });
});
