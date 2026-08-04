import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';

const CONCURRENT_ORDERS = 100;
const STOCK = 10;

describe('Order place — async placement under concurrency (e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 240000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  it(`${CONCURRENT_ORDERS} concurrent orders → all PENDING, ${CONCURRENT_ORDERS} ReserveStock commands, stock untouched`, async () => {
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

    const pending = responses.filter((r) => r.status === 201 && r.body.status === 'PENDING');
    expect(pending).toHaveLength(CONCURRENT_ORDERS);

    const stockRows = await stack.inventoryDb.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(stockRows[0].available)).toBe(STOCK);

    const sagaCount = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "order_saga" WHERE "tenant_id" = $1 AND "state" = \'STARTED\'',
      [tenantId],
    );
    expect(sagaCount[0].count).toBe(CONCURRENT_ORDERS);

    const commandCount = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "order_outbox" WHERE "tenant_id" = $1 AND "event_type" = \'ReserveStock\'',
      [tenantId],
    );
    expect(commandCount[0].count).toBe(CONCURRENT_ORDERS);
  }, 120000);
});
