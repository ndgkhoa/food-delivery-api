export type OrderFactStatus = 'CONFIRMED' | 'CANCELLED';

export interface OrdersFactRow {
  tenantId: string;
  orderId: string;
  restaurantId: string;
  userId: string;
  status: OrderFactStatus;
  totalCents: number;
  occurredAt: Date;
}
