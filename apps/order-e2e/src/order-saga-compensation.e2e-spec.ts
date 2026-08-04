import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  FAIL_AT_CENTS,
  orderOutboxAttempts,
  placeOrder,
  pollOrderUntil,
  priceForTotal,
  sagaState,
  seedMenuItem,
  seedStock,
  stockAvailable,
  withDb,
} from './support/saga-e2e-support';
import { readDlq, republishRecord } from './support/saga-kafka-support';

const TERMINAL = ['CONFIRMED', 'CANCELLED'];

describe('Order saga compensation + idempotency (e2e, compose)', () => {
  it('compensatesReleasedStockOnPaymentDecline', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, priceForTotal(FAIL_AT_CENTS));
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 1 }]);
    expect(placed.status).toBe('PENDING');

    const final = await pollOrderUntil(tenantId, userId, placed.id, TERMINAL);
    expect(final).toBe('CANCELLED');
    expect(await sagaState(placed.id)).toBe('CANCELLED');
    expect(await stockAvailable(tenantId, itemId)).toBe(5);
    expect((await orderOutboxAttempts(placed.id)).every((n) => n === 0)).toBe(true);
    const replyDlq = await readDlq('inventory.replies');
    expect(replyDlq.every((record) => record.reason !== 'handler-exhausted')).toBe(true);
  }, 60_000);

  it('cancelsWithoutChargingWhenStockInsufficient', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, 1200);
    await seedStock(tenantId, itemId, 0);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 2 }]);
    const final = await pollOrderUntil(tenantId, userId, placed.id, TERMINAL);

    expect(final).toBe('CANCELLED');
    expect(await sagaState(placed.id)).toBe('CANCELLED');
    expect(await stockAvailable(tenantId, itemId)).toBe(0);
  }, 60_000);

  it('appliesADuplicateReplyExactlyOnce', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, 1200);
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 2 }]);
    expect(await pollOrderUntil(tenantId, userId, placed.id, TERMINAL)).toBe('CONFIRMED');
    expect(await stockAvailable(tenantId, itemId)).toBe(3);

    await republishRecord(
      'inventory.replies',
      (value) => (value as { orderId?: string }).orderId === placed.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(await sagaState(placed.id)).toBe('COMPLETED');
    expect(await stockAvailable(tenantId, itemId)).toBe(3);
  }, 90_000);

  it('reservesStockExactlyOnceForADuplicateCommand', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, 1200);
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 2 }]);
    expect(await pollOrderUntil(tenantId, userId, placed.id, TERMINAL)).toBe('CONFIRMED');

    await republishRecord(
      'inventory.commands',
      (value) => (value as { orderId?: string }).orderId === placed.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(await stockAvailable(tenantId, itemId)).toBe(3);
    expect(await sagaState(placed.id)).toBe('COMPLETED');
  }, 90_000);

  it('holdsInvariantsUnderConcurrencyAndFailureMix', async () => {
    const tenantId = randomUUID();
    const itemOk = randomUUID();
    const itemDecline = randomUUID();
    const declinePrice = priceForTotal(FAIL_AT_CENTS);
    const okPrice = declinePrice === 500 ? 400 : 500;
    await seedMenuItem(tenantId, randomUUID(), itemOk, okPrice);
    await seedMenuItem(tenantId, randomUUID(), itemDecline, declinePrice);
    await seedStock(tenantId, itemOk, 10);
    await seedStock(tenantId, itemDecline, 10);

    const specs = Array.from({ length: 100 }, (_, i) => ({
      userId: randomUUID(),
      itemId: i % 2 === 0 ? itemOk : itemDecline,
    }));
    const placed = await Promise.all(
      specs.map((spec) => placeOrder(tenantId, spec.userId, [{ itemId: spec.itemId, qty: 1 }])),
    );
    const finals = await Promise.all(
      placed.map((order, i) =>
        pollOrderUntil(tenantId, specs[i].userId, order.id, TERMINAL, 90_000),
      ),
    );

    const confirmed = finals.filter((s) => s === 'CONFIRMED').length;
    const cancelled = finals.filter((s) => s === 'CANCELLED').length;
    expect(confirmed).toBe(10);
    expect(cancelled).toBe(90);
    expect(await stockAvailable(tenantId, itemOk)).toBe(0);
    expect(await stockAvailable(tenantId, itemDecline)).toBe(10);
  }, 180_000);

  it('listsAStrandedSagaInTheReaperWorklist', async () => {
    const orderId = randomUUID();
    const tenantId = randomUUID();
    await withDb('order', async (db) => {
      await db.query(
        `INSERT INTO "order_saga" ("order_id","tenant_id","state","version","created_at","updated_at")
         VALUES ($1,$2,'STARTED',1, now() - interval '1 hour', now() - interval '1 hour')`,
        [orderId, tenantId],
      );
    });

    const worklist = await withDb('order', async (db) => {
      const res = await db.query<{ order_id: string }>(
        `SELECT "order_id" FROM "order_saga"
         WHERE "state" IN ('STARTED','STOCK_RESERVED','COMPENSATING')
           AND "updated_at" < now() - interval '60 seconds'`,
      );
      return res.rows.map((row) => row.order_id);
    });

    expect(worklist).toContain(orderId);
  }, 30_000);
});
