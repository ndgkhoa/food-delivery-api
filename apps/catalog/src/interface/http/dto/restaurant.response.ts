export class RestaurantResponse {
  id!: string;
  tenantId!: string;
  name!: string;
  description!: string | null;
  isActive!: boolean;
  rating!: number;
  reviewCount!: number;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
