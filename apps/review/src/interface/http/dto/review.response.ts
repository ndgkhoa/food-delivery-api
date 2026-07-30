export class ReviewResponse {
  id!: string;
  tenantId!: string;
  orderId!: string;
  restaurantId!: string;
  userId!: string;
  rating!: number;
  comment!: string | null;
  createdAt!: Date;
}
