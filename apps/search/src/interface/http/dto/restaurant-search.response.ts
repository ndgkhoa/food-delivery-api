/** A single ranked search hit (score is the ES relevance score). */
export class RestaurantSearchHitResponse {
  id!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  rating!: number;
  score!: number;
}

/** Paginated search response — mirrors the catalog list-endpoint envelope. */
export class RestaurantSearchResponse {
  data!: RestaurantSearchHitResponse[];
  total!: number;
  page!: number;
  limit!: number;
}

/** A single autocomplete suggestion (id + display name). */
export class RestaurantAutocompleteResponse {
  id!: string;
  name!: string;
}
