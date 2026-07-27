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
  status: string;
  items: OrderItemResponse[];
  totalCents: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
