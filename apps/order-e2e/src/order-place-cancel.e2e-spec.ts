import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bootOrderStack, type OrderStack, shutdownOrderStack } from './support/boot-order-stack';
import { buildIdentityHeaders } from './support/build-identity-headers';

/**
 * Proves the core synchronous saga end-to-end against real Postgres (order +
 * inventory) and a real inventory gRPC channel: placing an order reserves
 * stock and lands RESERVED; cancelling it releases the stock again.
 *
 *   pnpm nx e2e order-e2e
 */
describe('Order place + cancel (e2e)', () => {
  let stack: OrderStack;

  beforeAll(async () => {
    stack = await bootOrderStack();
  }, 180000);

  afterAll(async () => {
    await shutdownOrderStack(stack);
  });

  async function seedStock(tenantId: string, itemId: string, available: number): Promise<void> {
    await stack.inventoryDb.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, available],
    );
  }

  async function stockAvailable(tenantId: string, itemId: string): Promise<number> {
    const rows = await stack.inventoryDb.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    return Number(rows[0]?.available);
  }

  it('reserves stock and returns a RESERVED order', async () => {
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
      priceCents: 1200,
      isAvailable: true,
    });

    const response = await request(stack.orderApp.getHttpServer())
      .post('/api/v1/orders')
      .set(buildIdentityHeaders(tenantId, userId))
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ itemId, qty: 2 }] });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('RESERVED');
    expect(response.body.totalCents).toBe(2400);
    expect(await stockAvailable(tenantId, itemId)).toBe(3);
  });

  it('cancels a reserved order and releases the stock', async () => {
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
    expect(await stockAvailable(tenantId, itemId)).toBe(2);

    const cancelled = await request(stack.orderApp.getHttpServer())
      .post(`/api/v1/orders/${placed.body.id}/cancel`)
      .set(headers)
      .send();

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await stockAvailable(tenantId, itemId)).toBe(5);
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
    expect(await stockAvailable(tenantId, itemId)).toBe(5);
  });
});
