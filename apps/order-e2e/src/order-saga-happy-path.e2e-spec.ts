import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { buildIdentityHeaders } from './support/build-identity-headers';

/**
 * End-to-end proof of the ASYNC order saga over the polling outbox + Kafka.
 * Unlike the in-process order-e2e specs, this one needs the LIVE compose stack
 * with order + inventory + payment services running (their relays + consumers
 * active), so it does NOT spin testcontainers:
 *
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   pnpm db:migrate                       # migrates catalog/auth/inventory/order/payment
 *   pnpm dev                              # runs gateway/catalog/auth/inventory/order/payment
 *   pnpm nx e2e order-e2e --testFile=order-saga-happy-path.e2e-spec.ts
 *
 * Env overrides: ORDER_BASE_URL (default http://localhost:3003/api/v1),
 * DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD (shared core Postgres),
 * PAYMENT_STUB_FAIL_AT_CENTS (must match the running payment stub).
 *
 * Seeds the catalog write model + inventory stock directly (schemas are stable),
 * then drives the saga purely through the order HTTP API and polls to the
 * terminal state.
 */
const ORDER_BASE_URL = process.env.ORDER_BASE_URL ?? 'http://localhost:3003/api/v1';
const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'abc123456',
};
const FAIL_AT_CENTS = Number(process.env.PAYMENT_STUB_FAIL_AT_CENTS ?? 66600);

async function withDb<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ ...DB, database });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function seedMenuItem(
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

async function seedStock(tenantId: string, itemId: string, available: number): Promise<void> {
  await withDb('inventory', (db) =>
    db.query('INSERT INTO "stock" ("tenant_id","item_id","available") VALUES ($1,$2,$3)', [
      tenantId,
      itemId,
      available,
    ]),
  );
}

async function stockAvailable(tenantId: string, itemId: string): Promise<number> {
  return withDb('inventory', async (db) => {
    const res = await db.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id"=$1 AND "item_id"=$2',
      [tenantId, itemId],
    );
    return Number(res.rows[0]?.available);
  });
}

async function sagaState(orderId: string): Promise<string | undefined> {
  return withDb('order', async (db) => {
    const res = await db.query<{ state: string }>(
      'SELECT "state" FROM "order_saga" WHERE "order_id"=$1',
      [orderId],
    );
    return res.rows[0]?.state;
  });
}

async function placeOrder(
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

async function pollStatus(
  tenantId: string,
  userId: string,
  orderId: string,
  terminal: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const headers = buildIdentityHeaders(tenantId, userId);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${ORDER_BASE_URL}/orders/${orderId}`, { headers });
    const body = (await res.json()) as { status: string };
    if (terminal.includes(body.status)) {
      return body.status;
    }
    if (Date.now() >= deadline) {
      throw new Error(`order ${orderId} stuck at ${body.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe('Order saga happy path (e2e, compose)', () => {
  it('drives an order PENDING → CONFIRMED via reserve + charge, decrementing stock', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, 1200);
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 2 }]);
    expect(placed.status).toBe('PENDING');

    const finalStatus = await pollStatus(tenantId, userId, placed.id, ['CONFIRMED', 'CANCELLED']);
    expect(finalStatus).toBe('CONFIRMED');
    expect(await sagaState(placed.id)).toBe('COMPLETED');
    expect(await stockAvailable(tenantId, itemId)).toBe(3);
  }, 60_000);

  it('100 concurrent orders on stock=10 → exactly 10 CONFIRMED, 90 CANCELLED, zero oversell', async () => {
    const tenantId = randomUUID();
    const itemId = randomUUID();
    // Price avoids the payment-decline trigger so only stock gates the outcome.
    const priceCents = FAIL_AT_CENTS === 500 ? 400 : 500;
    await seedMenuItem(tenantId, randomUUID(), itemId, priceCents);
    await seedStock(tenantId, itemId, 10);

    const users = Array.from({ length: 100 }, () => randomUUID());
    const placed = await Promise.all(
      users.map((userId) => placeOrder(tenantId, userId, [{ itemId, qty: 1 }])),
    );

    const finals = await Promise.all(
      placed.map((order, i) =>
        pollStatus(tenantId, users[i], order.id, ['CONFIRMED', 'CANCELLED'], 60_000),
      ),
    );

    const confirmed = finals.filter((s) => s === 'CONFIRMED').length;
    const cancelled = finals.filter((s) => s === 'CANCELLED').length;
    expect(confirmed).toBe(10);
    expect(cancelled).toBe(90);
    expect(await stockAvailable(tenantId, itemId)).toBe(0);
  }, 120_000);
});
