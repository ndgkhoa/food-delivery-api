/**
 * One command/event row appended to the polling outbox in the same transaction
 * as a domain write. The relay later publishes it to Kafka:
 * - `aggregateId` (order id) becomes the Kafka message key → per-order ordering
 * - `topic` is the destination topic
 * - `eventType` distinguishes `ReserveStock` vs `ChargePayment` etc.
 * - `payload` is the JSON event body
 *
 * Tenant is NOT carried here: the adapter stamps `tenant_id` from the tenant
 * context (so no call site can spoof it). `correlationId` threads ONE saga's
 * command+reply chain end to end — a reply handler passes the triggering
 * envelope's correlation id into the next command so the whole saga shares one
 * trace id; when omitted (the saga's first command) the adapter mints the root
 * id (the header must be non-null). Every outbox row is the sole emission source
 * of truth — handlers never publish to Kafka directly.
 */
export interface OutboxCommandEntry {
  aggregateId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Saga-wide trace id carried from the triggering event; the adapter mints one when absent. */
  correlationId?: string;
}

export interface OutboxWriter {
  append(entry: OutboxCommandEntry): Promise<void>;
}

export const OUTBOX_WRITER = Symbol('OutboxWriter');
