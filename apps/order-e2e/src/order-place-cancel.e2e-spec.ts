import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';
import { DEFAULT_DELIVERY_FEE_CENTS, DEFAULT_VAT_RATE_BPS } from './support/saga-e2e-support';

/**
 * Proves the ASYNC place-order contract against real Postgres (order +
 * inventory) + a real broker: placing an order no longer reserves inline — it
 * returns PENDING and, in ONE transaction, opens the saga (STARTED) and enqueues
 * a `ReserveStock` command to the outbox. The saga's cross-service progression
 * (relay + inventory/payment consumers) is OFF in this in-process stack
 * (NODE_ENV=test), so this asserts the provable-here portion; the full
 * happy-path lands in the compose e2e.
 *
 *   pnpm nx e2e order-e2e
 */
describe('Order place (async saga contract) + cancel (e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 240000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  async function seedStock(tenantId: string, itemId: string, available: number): Promise<void> {
    await stack.inventoryDb.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, available],
    );
  }

  async function sagaState(orderId: string): Promise<string | undefined> {
    const rows = await stack.orderDb.dataSource.query(
      'SELECT "state" FROM "order_saga" WHERE "order_id" = $1',
      [orderId],
    );
    return rows[0]?.state;
  }

  async function outboxRows(orderId: string): Promise<{ topic: string; event_type: string }[]> {
    return stack.orderDb.dataSource.query(
      'SELECT "topic", "event_type" FROM "order_outbox" WHERE "aggregate_id" = $1',
      [orderId],
    );
  }

  it('returns PENDING, opens the saga STARTED, and enqueues a ReserveStock command', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    const restaurantId = randomUUID();
    await seedStock(tenantId, itemId, 5);
    stack.catalogServer.seed(tenantId, {
      id: itemId,
      tenantId,
      restaurantId,
      name: 'Pho Bo',
      description: '',
      priceCents: 1200,
      isAvailable: true,
    });

    const response = await request(stack.orderApp.getHttpServer())
      .post('/api/v1/orders')
      .set(buildIdentityHeaders(tenantId, userId))
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ itemId, qty: 2 }] });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.restaurantId).toBe(restaurantId);
    // subtotal 2400 (2 x 1200) + the config-client's fallback defaults (no
    // config service running in this in-process stack): fee + VAT, discount 0.
    const subtotalCents = 2400;
    const vatCents = Math.floor((subtotalCents * DEFAULT_VAT_RATE_BPS) / 10000);
    expect(response.body.totalCents).toBe(subtotalCents + DEFAULT_DELIVERY_FEE_CENTS + vatCents);

    expect(await sagaState(response.body.id)).toBe('STARTED');
    const outbox = await outboxRows(response.body.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toEqual({ topic: 'inventory.commands', event_type: 'ReserveStock' });
  });

  it('cancels a PENDING order (no stock was reserved inline)', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedStock(tenantId, itemId, 5);
    stack.catalogServer.seed(tenantId, {
      id: itemId,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Pho Bo',
      description: '',
      priceCents: 1000,
      isAvailable: true,
    });
    const headers = buildIdentityHeaders(tenantId, userId);

    const placed = await request(stack.orderApp.getHttpServer())
      .post('/api/v1/orders')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ itemId, qty: 3 }] });
    expect(placed.status).toBe(201);
    expect(placed.body.status).toBe('PENDING');

    const cancelled = await request(stack.orderApp.getHttpServer())
      .post(`/api/v1/orders/${placed.body.id}/cancel`)
      .set(headers)
      .send();

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('rejects placing an order when the item is unavailable in the catalog', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedStock(tenantId, itemId, 5);
    stack.catalogServer.seed(tenantId, {
      id: itemId,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Sold Out Special',
      description: '',
      priceCents: 900,
      isAvailable: false,
    });

    const response = await request(stack.orderApp.getHttpServer())
      .post('/api/v1/orders')
      .set(buildIdentityHeaders(tenantId, userId))
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ itemId, qty: 1 }] });

    expect(response.status).toBe(422);
  });

  it('rejects placing an order whose items span two different restaurants', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    await seedStock(tenantId, itemA, 5);
    await seedStock(tenantId, itemB, 5);
    stack.catalogServer.seed(tenantId, {
      id: itemA,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Pho Bo',
      description: '',
      priceCents: 1200,
      isAvailable: true,
    });
    stack.catalogServer.seed(tenantId, {
      id: itemB,
      tenantId,
      restaurantId: randomUUID(),
      name: 'Sushi Roll',
      description: '',
      priceCents: 900,
      isAvailable: true,
    });

    const response = await request(stack.orderApp.getHttpServer())
      .post('/api/v1/orders')
      .set(buildIdentityHeaders(tenantId, userId))
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [
          { itemId: itemA, qty: 1 },
          { itemId: itemB, qty: 1 },
        ],
      });

    expect(response.status).toBe(400);
  });
});
