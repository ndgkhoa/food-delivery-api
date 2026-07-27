export class MenuItemResponse {
  id!: string;
  tenantId!: string;
  restaurantId!: string;
  name!: string;
  description!: string | null;
  priceCents!: number;
  isAvailable!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
