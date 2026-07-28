/**
 * One reply row appended to the polling outbox in the same transaction as the
 * dedupe marker. The relay later publishes it to Kafka:
 * - `aggregateId` (order id) becomes the Kafka message key → per-order ordering
 * - `topic` is the destination topic (`payment.replies`)
 * - `eventType` distinguishes `PaymentSucceeded` / `PaymentFailed`
 * - `payload` is the JSON event body
 *
 * Tenant + correlation identity are stamped by the adapter (tenant from the
 * consume-time context, a fresh correlation id) — never from the entry.
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
