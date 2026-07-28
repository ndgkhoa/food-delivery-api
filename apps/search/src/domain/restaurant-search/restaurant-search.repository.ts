import type {
  RestaurantAutocompleteQuery,
  RestaurantAutocompleteSuggestion,
  RestaurantSearchDocument,
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';

/**
 * Port for the restaurant search read model. `upsert`/`remove` are the
 * projection's write path (idempotent by document id); `search`/`autocomplete`
 * are the query path. All operations are tenant-scoped — reads filter on the
 * tenant term so one tenant can never see another's restaurants.
 */
export interface RestaurantSearchRepository {
  upsert(document: RestaurantSearchDocument): Promise<void>;
  remove(id: string, tenantId: string, version: number): Promise<void>;
  search(query: RestaurantSearchQuery): Promise<RestaurantSearchResult>;
  autocomplete(query: RestaurantAutocompleteQuery): Promise<RestaurantAutocompleteSuggestion[]>;
}

export const RESTAURANT_SEARCH_REPOSITORY = Symbol('RestaurantSearchRepository');
