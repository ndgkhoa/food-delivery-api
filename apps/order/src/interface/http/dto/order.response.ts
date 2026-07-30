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
  /** Sum of every line item's `lineTotalCents`, before delivery fee/VAT/discount. */
  subtotalCents: number;
  /** Config-sourced delivery fee applied at placement time (integer cents). */
  deliveryFeeCents: number;
  /** `floor(subtotalCents * vatRateBps / 10000)`, applied at placement time (integer cents). */
  vatCents: number;
  /** Config-sourced discount applied at placement time (integer cents). */
  discountCents: number;
  /** `subtotalCents + deliveryFeeCents + vatCents - discountCents`, floored at 0. */
  totalCents: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
