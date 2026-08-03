/** Order lifecycle statuses `order.events` carries — the only two an `OrderConfirmed`/`OrderCancelled` fact row can hold. */
export type OrderFactStatus = 'CONFIRMED' | 'CANCELLED';

/**
 * One denormalized fact row derived from a single `order.events` message.
 * Written once per delivery (including redeliveries — the ReplacingMergeTree
 * table engine collapses duplicates on merge, not this type). `restaurantId`
 * is `''` (never `undefined`) for a straggler order confirmed without one, so
 * the ClickHouse column stays a plain `String` and top-restaurant queries can
 * filter it out with a simple inequality.
 */
export interface OrdersFactRow {
  tenantId: string;
  orderId: string;
  restaurantId: string;
  userId: string;
  status: OrderFactStatus;
  totalCents: number;
  /** When the order transitioned to this status (the envelope's `occurredAt`), not when it was ingested. */
  occurredAt: Date;
}
