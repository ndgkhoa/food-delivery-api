import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { SeedConfig } from './seed-config';

export interface MonthPartitionRange {
  partitionName: string;
  fromDate: string;
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

export function computeMonthPartitionRange(
  referenceDate: Date,
  monthOffset: number,
): MonthPartitionRange {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month + monthOffset, 1));
  const next = new Date(Date.UTC(year, month + monthOffset + 1, 1));
  const yyyymm = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    partitionName: `orders_p${yyyymm}`,
    fromDate: start.toISOString().slice(0, 10),
    toDateExclusive: next.toISOString().slice(0, 10),
  };
}

export async function partitionExists(client: Client, partitionName: string): Promise<boolean> {
  const result = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
    `public.${partitionName}`,
  ]);
  return result.rows[0]?.oid !== null;
}

export async function createMonthPartition(
  client: Client,
  range: MonthPartitionRange,
): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${range.partitionName}" PARTITION OF "orders" ` +
      `FOR VALUES FROM ('${range.fromDate} 00:00:00+00') TO ('${range.toDateExclusive} 00:00:00+00')`,
  );
}

export async function dropMonthPartition(client: Client, partitionName: string): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS "${partitionName}"`);
}

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

export async function deleteBackdatedOrder(client: Client, orderId: string): Promise<void> {
  await client.query('DELETE FROM "order_items" WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM "orders" WHERE id = $1', [orderId]);
}
