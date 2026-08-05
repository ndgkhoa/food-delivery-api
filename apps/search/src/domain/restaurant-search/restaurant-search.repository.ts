import type {
  RestaurantAutocompleteQuery,
  RestaurantAutocompleteSuggestion,
  RestaurantSearchDocument,
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';

export interface RestaurantSearchRepository {
  upsert(document: RestaurantSearchDocument): Promise<void>;
  remove(id: string, tenantId: string, version: number): Promise<void>;
  search(query: RestaurantSearchQuery): Promise<RestaurantSearchResult>;
  autocomplete(query: RestaurantAutocompleteQuery): Promise<RestaurantAutocompleteSuggestion[]>;
  updateRating(id: string, tenantId: string, rating: number): Promise<void>;
}

export const RESTAURANT_SEARCH_REPOSITORY = Symbol('RestaurantSearchRepository');
