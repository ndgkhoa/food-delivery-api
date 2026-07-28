import { Controller, Get, Query } from '@nestjs/common';
import { AutocompleteRestaurantsHandler } from '@search/application/restaurant-search/queries/autocomplete-restaurants.handler';
import { SearchRestaurantsHandler } from '@search/application/restaurant-search/queries/search-restaurants.handler';
import { AutocompleteRestaurantsRequest } from '@search/interface/http/dto/autocomplete-restaurants.request';
import type {
  RestaurantAutocompleteResponse,
  RestaurantSearchResponse,
} from '@search/interface/http/dto/restaurant-search.response';
import { SearchRestaurantsRequest } from '@search/interface/http/dto/search-restaurants.request';

/**
 * Public read API for restaurant search. Both routes are tenant-scoped: the
 * query handlers read the tenant from the trusted identity the gateway verified
 * and propagated (never a raw client header), so a caller only ever sees its own
 * tenant's restaurants.
 *
 * `autocomplete` is a distinct static subpath of `search/restaurants`, so it
 * never collides with the collection root.
 */
@Controller('search/restaurants')
export class SearchController {
  constructor(
    private readonly searchRestaurants: SearchRestaurantsHandler,
    private readonly autocompleteRestaurants: AutocompleteRestaurantsHandler,
  ) {}

  @Get()
  search(@Query() dto: SearchRestaurantsRequest): Promise<RestaurantSearchResponse> {
    return this.searchRestaurants.execute({ q: dto.q, page: dto.page, limit: dto.limit });
  }

  @Get('autocomplete')
  autocomplete(
    @Query() dto: AutocompleteRestaurantsRequest,
  ): Promise<RestaurantAutocompleteResponse[]> {
    return this.autocompleteRestaurants.execute({ q: dto.q, limit: dto.limit });
  }
}
