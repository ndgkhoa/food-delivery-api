import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';

describe('Order idempotency (async, e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 240000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  it('returns the same PENDING order for a duplicate key and enqueues ReserveStock once', async () => {
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

    const first = await placeOnce();
    const second = await placeOnce();

    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PENDING');
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const orders = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "orders" WHERE "tenant_id" = $1',
      [tenantId],
    );
    expect(orders[0].count).toBe(1);

    const commands = await stack.orderDb.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "order_outbox" WHERE "aggregate_id" = $1',
      [first.body.id],
    );
    expect(commands[0].count).toBe(1);
  });
});
