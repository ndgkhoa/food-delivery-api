/**
 * The read-model document one restaurant projects into the search index. A
 * denormalized projection of the catalog write model — never a source of truth.
 * `rating` defaults to 0 (review events populate it in a later slice) and feeds
 * the relevance boost. `version` is a monotonic guard (event occurrence time in
 * epoch millis) so a redelivered or out-of-order event can never overwrite a
 * newer state; the adapter maps it to Elasticsearch external versioning.
 */
export interface RestaurantSearchDocument {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  rating: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A single ranked search hit returned to the query layer (score = relevance). */
export interface RestaurantSearchHit {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  rating: number;
  score: number;
}

/** Paginated search response — mirrors the catalog list-endpoint shape. */
export interface RestaurantSearchResult {
  data: RestaurantSearchHit[];
  total: number;
  page: number;
  limit: number;
}

/** A lightweight autocomplete suggestion (id + display name, no scoring surfaced). */
export interface RestaurantAutocompleteSuggestion {
  id: string;
  name: string;
}

/** Tenant-scoped full-text query params (tenantId comes from the trusted identity, never the client). */
export interface RestaurantSearchQuery {
  tenantId: string;
  q: string;
  page: number;
  limit: number;
}

/** Tenant-scoped prefix query params for the edge-ngram autocomplete field. */
export interface RestaurantAutocompleteQuery {
  tenantId: string;
  q: string;
  limit: number;
}
