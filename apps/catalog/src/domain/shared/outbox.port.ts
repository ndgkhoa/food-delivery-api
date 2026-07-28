/**
 * One row appended to the CDC outbox in the same transaction as a domain
 * write. Debezium's Outbox Event Router reads these columns:
 * - `aggregateType` routes the message to `<aggregateType>.events`
 * - `aggregateId` becomes the Kafka message key (per-aggregate ordering)
 * - `type` distinguishes `RestaurantCreated` vs `MenuItemUpdated` etc.
 * - `payload` is the denormalized snapshot consumers project from
 *
 * Tenant + correlation identity are NOT carried here: the adapter stamps
 * `tenant_id` from the tenant context (so no call site can spoof it, mirroring
 * the audit writer) and mints a `correlationid`. Every outbox row is the sole
 * emission source of truth — handlers never publish to Kafka directly.
 */
export interface OutboxEntry {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface OutboxWriter {
  write(entry: OutboxEntry): Promise<void>;
}

export const OUTBOX_PORT = Symbol('OutboxPort');
