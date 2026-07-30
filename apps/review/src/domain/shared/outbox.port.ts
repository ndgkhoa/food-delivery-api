/**
 * One event row appended to the polling outbox in the same transaction as the
 * review write. A relay later publishes it to Kafka (mirrors order's
 * outbox/relay shape — see `apps/order/src/domain/shared/outbox.port.ts`):
 * - `aggregateId` becomes the Kafka message key → per-restaurant ordering
 *   (the recompute event is keyed by RESTAURANT id, not review id, so catalog
 *   and search always see a given restaurant's rating changes in order).
 * - `topic`/`eventType`/`payload` describe the event itself.
 *
 * Tenant is NOT carried here: the adapter stamps `tenant_id` from the tenant
 * context (so no call site can spoof it). Every outbox row is the sole
 * emission source of truth — handlers never publish to Kafka directly.
 */
export interface OutboxCommandEntry {
  aggregateId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export interface OutboxWriter {
  append(entry: OutboxCommandEntry): Promise<void>;
}

export const OUTBOX_WRITER = Symbol('OutboxWriter');
