import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { SeedConfig } from './seed-config';

export interface MonthPartitionRange {
  /** e.g. `orders_p202608`. */
  partitionName: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  fromDate: string;
  /** Exclusive upper bound, `YYYY-MM-DD` — the first day of the FOLLOWING month. */
  toDateExclusive: string;
}

export interface BackdatedOrderInput {
  id: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
  itemId: string;
  createdAt: Date;
}

/**
 * Direct carve-out into the order service's own Postgres database
 * (`ORDER_DB_NAME`, default `order`) — used ONLY by the order-partitioning
 * demo scenario (`seed-up-scenario-partitioning.ts`), to insert historical
 * (backdated) order rows and create the monthly RANGE partitions that
 * receive them. `orders`/`order_items` have no HTTP surface for backdating
 * `created_at` (a real `POST /orders` always stamps "now"), so this mirrors
 * the schema from
 * `apps/order/src/infrastructure/persistence/migrations/*-partition-orders-by-month.ts`
 * column-for-column, the same deliberate-carve-out pattern as
 * `inventory-stock-db.ts` / `media-db.ts`.
 */
export async function withOrderDb<T>(
  config: SeedConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUsername,
    password: config.dbPassword,
    database: config.orderDbName,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Pure boundary math for calendar month `monthOffset` relative to
 * `referenceDate` (0 = the reference month, -1 = the previous month, …), in
 * UTC — a self-contained copy of `computeMonthPartitionRange` in
 * `apps/order/src/infrastructure/persistence/partitioning/orders-partition-maintenance.ts`
 * (not a cross-app import: the seeder never depends on `apps/order`'s
 * compiled output). Keep in sync if that function's boundary math changes.
 */
export function computeMonthPartitionRange(
  referenceDate: Date,
  monthOffset: number,
): MonthPartitionRange {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth(); // 0-based
  const start = new Date(Date.UTC(year, month + monthOffset, 1));
  const next = new Date(Date.UTC(year, month + monthOffset + 1, 1));
  const yyyymm = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    partitionName: `orders_p${yyyymm}`,
    fromDate: start.toISOString().slice(0, 10),
    toDateExclusive: next.toISOString().slice(0, 10),
  };
}

/** `to_regclass` returns NULL when the relation doesn't exist — the standard Postgres existence check, no exception-driven control flow. */
export async function partitionExists(client: Client, partitionName: string): Promise<boolean> {
  const result = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
    `public.${partitionName}`,
  ]);
  return result.rows[0]?.oid !== null;
}

/**
 * Mirrors the exact `CREATE ... PARTITION OF "orders"` SQL from the
 * migration/maintenance service. Bounds are computed UTC dates (never user
 * input) and the partition name is derived from those same dates; the
 * identifier is quoted.
 */
export async function createMonthPartition(
  client: Client,
  range: MonthPartitionRange,
): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${range.partitionName}" PARTITION OF "orders" ` +
      `FOR VALUES FROM ('${range.fromDate} 00:00:00+00') TO ('${range.toDateExclusive} 00:00:00+00')`,
  );
}

/** Scoped teardown of exactly one partition this seeder created — never the DEFAULT partition or any month it didn't create itself (see `seed-up-scenario-partitioning.ts`). */
export async function dropMonthPartition(client: Client, partitionName: string): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS "${partitionName}"`);
}

/**
 * Inserts one minimal-but-valid backdated order + its single order item,
 * mirroring `OrderOrmEntity`/`OrderItemOrmEntity` column-for-column (explicit
 * column lists, never relying on defaults for anything the demo cares about).
 * `status` is CONFIRMED (a plausible terminal historical order); pricing is a
 * small fixed demo total — these rows exist to prove partition pruning, not
 * to exercise pricing. `created_at`/`updated_at` are stamped explicitly (not
 * `now()`) so the row lands in the target month's partition. Ids are
 * generated in code (never `gen_random_uuid()`) so this never depends on a
 * Postgres extension being enabled.
 */
export async function insertBackdatedOrder(
  client: Client,
  input: BackdatedOrderInput,
): Promise<void> {
  const subtotalCents = 3000;
  const deliveryFeeCents = 1200;
  const vatCents = 240;
  const discountCents = 0;
  const totalCents = subtotalCents + deliveryFeeCents + vatCents - discountCents;

  await client.query(
    `INSERT INTO "orders"
       ("id","tenant_id","user_id","restaurant_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","version","created_at","updated_at")
     VALUES ($1,$2,$3,$4,'CONFIRMED',$5,$6,$7,$8,$9,1,$10,$10)`,
    [
      input.id,
      input.tenantId,
      input.userId,
      input.restaurantId,
      subtotalCents,
      deliveryFeeCents,
      vatCents,
      discountCents,
      totalCents,
      input.createdAt,
    ],
  );
  await client.query(
    `INSERT INTO "order_items" ("id","order_id","item_id","qty","unit_price_cents","line_total_cents")
     VALUES ($1,$2,$3,1,$4,$4)`,
    [randomUUID(), input.id, input.itemId, subtotalCents],
  );
}

/** Scoped delete of exactly one backdated order — `order_items` first (no FK to cascade through since the partition migration drops it), then the `orders` row itself. Never a table-wide delete. */
export async function deleteBackdatedOrder(client: Client, orderId: string): Promise<void> {
  await client.query('DELETE FROM "order_items" WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM "orders" WHERE id = $1', [orderId]);
}
