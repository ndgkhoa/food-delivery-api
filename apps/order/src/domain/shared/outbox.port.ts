/**
 * One command/event row appended to the polling outbox in the same transaction
 * as a domain write. The relay later publishes it to Kafka:
 * - `aggregateId` (order id) becomes the Kafka message key → per-order ordering
 * - `topic` is the destination topic
 * - `eventType` distinguishes `ReserveStock` vs `ChargePayment` etc.
 * - `payload` is the JSON event body
 *
 * Tenant + correlation identity are NOT carried here: the adapter stamps
 * `tenant_id` from the tenant context (so no call site can spoof it) and mints
 * a `correlation_id`. Every outbox row is the sole emission source of truth —
 * handlers never publish to Kafka directly.
 */
export interface OutboxCommandEntry {
  aggregateId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface OutboxWriter {
  append(entry: OutboxCommandEntry): Promise<void>;
}

export const OUTBOX_WRITER = Symbol('OutboxWriter');
