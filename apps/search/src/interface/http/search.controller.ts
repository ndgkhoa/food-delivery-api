import { Controller, Get, Query } from '@nestjs/common';
import { AutocompleteRestaurantsHandler } from '@search/application/restaurant-search/queries/autocomplete-restaurants.handler';
import { SearchRestaurantsHandler } from '@search/application/restaurant-search/queries/search-restaurants.handler';
import { AutocompleteRestaurantsRequest } from '@search/interface/http/dto/autocomplete-restaurants.request';
import type {
  RestaurantAutocompleteResponse,
  RestaurantSearchResponse,
} from '@search/interface/http/dto/restaurant-search.response';
import { SearchRestaurantsRequest } from '@search/interface/http/dto/search-restaurants.request';

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
