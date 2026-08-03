export class MenuItemResponse {
  id!: string;
  tenantId!: string;
  restaurantId!: string;
  name!: string;
  description!: string | null;
  priceCents!: number;
  isAvailable!: boolean;
  /** Optimistic-lock version — send back as the `If-Match` header on a subsequent PATCH. */
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
