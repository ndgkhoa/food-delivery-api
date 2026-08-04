interface OrderItemResponse {
  itemId: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface OrderResponse {
  id: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
  status: string;
  items: OrderItemResponse[];
  subtotalCents: number;
  deliveryFeeCents: number;
  vatCents: number;
  discountCents: number;
  totalCents: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
