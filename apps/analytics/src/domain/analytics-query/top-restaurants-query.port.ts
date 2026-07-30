import type { DateRange } from '@analytics/domain/analytics-query/date-range';

/** One restaurant's aggregate standing in a top-restaurants result, ranked by revenue. */
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

/**
 * Read port for the top-restaurants dashboard: CONFIRMED orders grouped by
 * restaurant, ranked by revenue, within the caller's tenant and date range. A
 * fact row with no restaurant attribution (a pre-invariant straggler order)
 * never appears here — it's still counted in revenue/summary, just not
 * attributable to any one restaurant.
 */
export interface TopRestaurantsQueryPort {
  query(input: TopRestaurantsQuery): Promise<TopRestaurantEntry[]>;
}

export const TOP_RESTAURANTS_QUERY = Symbol('TopRestaurantsQueryPort');
