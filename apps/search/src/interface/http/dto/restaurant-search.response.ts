export class RestaurantSearchHitResponse {
  id!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  rating!: number;
  score!: number;
}

export class RestaurantSearchResponse {
  data!: RestaurantSearchHitResponse[];
  total!: number;
  page!: number;
  limit!: number;
}

export class RestaurantAutocompleteResponse {
  id!: string;
  name!: string;
}
