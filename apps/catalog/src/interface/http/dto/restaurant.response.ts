export class RestaurantResponse {
  id!: string;
  tenantId!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
