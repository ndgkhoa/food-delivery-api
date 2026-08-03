/** One restaurant's standing in the ranking, ordered by revenue descending. */
export class TopRestaurantResponse {
  restaurantId!: string;
  revenueCents!: number;
  orderCount!: number;
}
