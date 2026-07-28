import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { buildIdentityHeaders } from './build-identity-headers';

/**
 * Shared harness for the compose-based order-saga e2e specs. These specs need
 * the LIVE stack (order + inventory + payment services with their relays +
 * consumers active) plus `core`+`messaging` — they do NOT spin testcontainers.
 * The helpers here seed the catalog + inventory databases directly (schemas are
 * stable), drive the saga through the order HTTP API, and poll to a terminal
 * state. See each spec's header for the exact bring-up commands.
 */
const ORDER_BASE_URL = process.env.ORDER_BASE_URL ?? 'http://localhost:3003/api/v1';

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'abc123456',
};

/** Order total (cents) the deterministic payment stub DECLINES — must match the running stub. */
export const FAIL_AT_CENTS = Number(process.env.PAYMENT_STUB_FAIL_AT_CENTS ?? 66600);

/** Kafka brokers the injection helpers connect to (duplicate/DLQ). */
export const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

export async function withDb<T>(
  database: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ ...DB, database });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function seedMenuItem(
  tenantId: string,
  restaurantId: string,
  itemId: string,
  priceCents: number,
): Promise<void> {
  await withDb('catalog', async (db) => {
    await db.query('INSERT INTO "restaurants" ("id","tenant_id","name") VALUES ($1,$2,$3)', [
      restaurantId,
      tenantId,
      'Saga Diner',
    ]);
    await db.query(
      'INSERT INTO "menu_items" ("id","tenant_id","restaurant_id","name","price_cents","is_available") VALUES ($1,$2,$3,$4,$5,true)',
      [itemId, tenantId, restaurantId, 'Saga Special', priceCents],
    );
  });
}

export async function seedStock(
  tenantId: string,
  itemId: string,
  available: number,
): Promise<void> {
  await withDb('inventory', (db) =>
    db.query('INSERT INTO "stock" ("tenant_id","item_id","available") VALUES ($1,$2,$3)', [
      tenantId,
      itemId,
      available,
    ]),
  );
}

export async function stockAvailable(tenantId: string, itemId: string): Promise<number> {
  return withDb('inventory', async (db) => {
    const res = await db.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id"=$1 AND "item_id"=$2',
      [tenantId, itemId],
    );
    return Number(res.rows[0]?.available);
  });
}

export async function sagaState(orderId: string): Promise<string | undefined> {
  return withDb('order', async (db) => {
    const res = await db.query<{ state: string }>(
      'SELECT "state" FROM "order_saga" WHERE "order_id"=$1',
      [orderId],
    );
    return res.rows[0]?.state;
  });
}

/** Reads the outbox `attempts` counters for an order's saga rows (publish-failure visibility). */
export async function orderOutboxAttempts(orderId: string): Promise<number[]> {
  return withDb('order', async (db) => {
    const res = await db.query<{ attempts: number }>(
      'SELECT "attempts" FROM "order_outbox" WHERE "aggregate_id"=$1',
      [orderId],
    );
    return res.rows.map((row) => Number(row.attempts));
  });
}

export async function placeOrder(
  tenantId: string,
  userId: string,
  items: { itemId: string; qty: number }[],
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${ORDER_BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      ...buildIdentityHeaders(tenantId, userId),
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ items }),
  });
  return (await res.json()) as { id: string; status: string };
}

async function getOrderStatus(tenantId: string, userId: string, orderId: string): Promise<string> {
  const res = await fetch(`${ORDER_BASE_URL}/orders/${orderId}`, {
    headers: buildIdentityHeaders(tenantId, userId),
  });
  return ((await res.json()) as { status: string }).status;
}

/**
 * Polls `GET /orders/:id` until the status is one of `terminal`, or throws with
 * the last-seen status when the bounded timeout elapses (clear diagnostics).
 */
export async function pollOrderUntil(
  tenantId: string,
  userId: string,
  orderId: string,
  terminal: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'UNKNOWN';
  for (;;) {
    last = await getOrderStatus(tenantId, userId, orderId);
    if (terminal.includes(last)) {
      return last;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `order ${orderId} did not reach [${terminal.join(', ')}] within ${timeoutMs}ms (last: ${last})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
