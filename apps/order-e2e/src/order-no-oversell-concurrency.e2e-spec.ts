import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';

const CONCURRENT_ORDERS = 100;
const STOCK = 10;

/**
 * The no-oversell PROOF at the order level: 100 concurrent place-order
 * requests for the same single-unit item, against real Postgres (order +
 * inventory) and a real inventory gRPC channel guarded by inventory's Redis
 * lock + atomic conditional decrement. Exactly `STOCK` must land RESERVED;
 * the rest must fail cleanly with InsufficientStockError (409) — never an
 * oversold reservation.
 *
 *   pnpm nx e2e order-e2e
 */
describe('Order place — no-oversell under concurrency (e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 180000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  it(`${CONCURRENT_ORDERS} concurrent single-item orders against stock=${STOCK} → exactly ${STOCK} RESERVED, rest InsufficientStock, available=0`, async () => {
    const tenantId = randomUUID();
    const itemId = randomUUID();
    await stack.inventoryDb.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, STOCK],
    );
    stack.catalogServer.seed(tenantId, {
      id: itemId,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Limited Edition Banh Mi',
      description: '',
      priceCents: 750,
      isAvailable: true,
    });

    const attempts = Array.from({ length: CONCURRENT_ORDERS }, () =>
      request(stack.orderApp.getHttpServer())
        .post('/api/v1/orders')
        .set(buildIdentityHeaders(tenantId, randomUUID()))
        .set('Idempotency-Key', randomUUID())
        .send({ items: [{ itemId, qty: 1 }] }),
    );
    const responses = await Promise.all(attempts);

    const reserved = responses.filter((r) => r.status === 201 && r.body.status === 'RESERVED');
    const rejected = responses.filter((r) => r.status === 409);
    expect(reserved).toHaveLength(STOCK);
    expect(rejected).toHaveLength(CONCURRENT_ORDERS - STOCK);

    const rows = await stack.inventoryDb.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(rows[0].available)).toBe(0);

    const cancelledOrders = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "orders" WHERE "tenant_id" = $1 AND "status" = $2',
      [tenantId, 'CANCELLED'],
    );
    expect(cancelledOrders[0].count).toBe(CONCURRENT_ORDERS - STOCK);

    const reservedOrders = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "orders" WHERE "tenant_id" = $1 AND "status" = $2',
      [tenantId, 'RESERVED'],
    );
    expect(reservedOrders[0].count).toBe(STOCK);
  }, 120000);
});
