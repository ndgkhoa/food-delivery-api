import type { DateRange } from '@analytics/domain/analytics-query/date-range';

export interface TopRestaurantEntry {
  restaurantId: string;
  revenueCents: number;
  orderCount: number;
}

export interface TopRestaurantsQuery {
  tenantId: string;
  range: DateRange;
  limit: number;
}

export interface TopRestaurantsQueryPort {
  query(input: TopRestaurantsQuery): Promise<TopRestaurantEntry[]>;
}

export const TOP_RESTAURANTS_QUERY = Symbol('TopRestaurantsQueryPort');
