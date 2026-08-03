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
  /**
   * Partial update of just the `rating` field, driven by the review service's
   * `RestaurantRatingChanged`. Deliberately NOT `upsert` — that would require
   * the full document (name/description/...) which the rating event never
   * carries. A restaurant not yet indexed (rare race with the catalog
   * projection) is a safe no-op: the initial `catalog.events` upsert seeds
   * `rating: 0` and, since this is a real event delivered after that write in
   * practice, the common case always finds the doc.
   */
  updateRating(id: string, tenantId: string, rating: number): Promise<void>;
}

export const RESTAURANT_SEARCH_REPOSITORY = Symbol('RestaurantSearchRepository');
