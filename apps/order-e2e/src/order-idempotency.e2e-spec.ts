import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';

/**
 * Proves that replaying the same `Idempotency-Key` (a client retry after a
 * dropped response, or a genuine double-submit) never double-reserves stock
 * or creates a second order — the key is claimed via a real Postgres unique
 * constraint before inventory is ever called.
 *
 *   pnpm nx e2e order-e2e
 */
describe('Order idempotency (e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 180000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  it('returns the same order for a duplicate Idempotency-Key and decrements stock once', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    const idempotencyKey = randomUUID();

    await stack.inventoryDb.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, 10],
    );
    stack.catalogServer.seed(tenantId, {
      id: itemId,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Spring Rolls',
      description: '',
      priceCents: 400,
      isAvailable: true,
    });

    const headers = buildIdentityHeaders(tenantId, userId);
    const placeOnce = () =>
      request(stack.orderApp.getHttpServer())
        .post('/api/v1/orders')
        .set(headers)
        .set('Idempotency-Key', idempotencyKey)
        .send({ items: [{ itemId, qty: 2 }] });

    // A client retry (e.g. a dropped response) resends the identical request
    // sequentially, after the first has fully completed — the scenario the
    // idempotency key is meant to guard.
    const first = await placeOnce();
    const second = await placeOnce();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const rows = await stack.inventoryDb.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(rows[0].available)).toBe(8);

    const orders = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "orders" WHERE "tenant_id" = $1',
      [tenantId],
    );
    expect(orders[0].count).toBe(1);
  });
});
