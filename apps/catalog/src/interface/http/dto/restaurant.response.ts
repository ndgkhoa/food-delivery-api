export class RestaurantResponse {
  id!: string;
  tenantId!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  /** Aggregate rating fed by the review service (0 for a restaurant with no reviews yet). */
  rating!: number;
  reviewCount!: number;
  /** Optimistic-lock version — send back as the `If-Match` header on a subsequent PATCH. */
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
