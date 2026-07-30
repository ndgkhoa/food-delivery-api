import type { OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';

/**
 * Write side of the analytics read model: appends one fact row per ingested
 * order lifecycle event. Never updates or deletes — a redelivery of the same
 * `(tenantId, orderId)` is just another insert; the ClickHouse adapter's table
 * engine (ReplacingMergeTree) is what makes that redelivery-safe, not this port.
 */
export interface OrdersFactWriterPort {
  write(row: OrdersFactRow): Promise<void>;
}

export const ORDERS_FACT_WRITER = Symbol('OrdersFactWriterPort');
