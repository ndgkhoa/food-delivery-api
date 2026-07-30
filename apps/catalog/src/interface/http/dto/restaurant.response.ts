export class RestaurantResponse {
  id!: string;
  tenantId!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  /** Aggregate rating fed by the review service (0 for a restaurant with no reviews yet). */
  rating!: number;
  reviewCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
