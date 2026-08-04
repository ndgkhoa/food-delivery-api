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

export interface RestaurantSearchHit {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  rating: number;
  score: number;
}

export interface RestaurantSearchResult {
  data: RestaurantSearchHit[];
  total: number;
  page: number;
  limit: number;
}

export interface RestaurantAutocompleteSuggestion {
  id: string;
  name: string;
}

export interface RestaurantSearchQuery {
  tenantId: string;
  q: string;
  page: number;
  limit: number;
}

export interface RestaurantAutocompleteQuery {
  tenantId: string;
  q: string;
  limit: number;
}
