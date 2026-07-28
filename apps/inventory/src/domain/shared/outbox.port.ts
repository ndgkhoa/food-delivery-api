/**
 * One reply/event row appended to the polling outbox in the same transaction as
 * the dedupe marker. The relay later publishes it to Kafka:
 * - `aggregateId` (order id) becomes the Kafka message key → per-order ordering
 * - `topic` is the destination topic (`inventory.replies`)
 * - `eventType` distinguishes `StockReserved` / `StockReservationFailed` / `StockReleased`
 * - `payload` is the JSON event body
 *
 * Tenant is stamped by the adapter from the consume-time tenant context — never
 * from the entry. `correlationId` carries the triggering command's saga-wide
 * trace id onto the reply so the whole saga shares one id; the adapter mints one
 * only when it is absent (the header must be non-null).
 */
export interface OutboxCommandEntry {
  aggregateId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Saga-wide trace id carried from the triggering command; the adapter mints one when absent. */
  correlationId?: string;
}

export interface OutboxWriter {
  append(entry: OutboxCommandEntry): Promise<void>;
}

export const OUTBOX_WRITER = Symbol('OutboxWriter');
