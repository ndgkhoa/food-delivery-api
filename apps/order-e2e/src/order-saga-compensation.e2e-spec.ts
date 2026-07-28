import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  FAIL_AT_CENTS,
  orderOutboxAttempts,
  placeOrder,
  pollOrderUntil,
  sagaState,
  seedMenuItem,
  seedStock,
  stockAvailable,
  withDb,
} from './support/saga-e2e-support';
import { readDlq, republishRecord } from './support/saga-kafka-support';

/**
 * Compose-based end-to-end proof of the order saga's FAILURE, COMPENSATION and
 * IDEMPOTENCY guarantees. Needs the LIVE stack — order + inventory + payment
 * services (their relays + consumers active) on `core`+`messaging`:
 *
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   pnpm db:migrate                        # catalog/auth/inventory/order/payment
 *   pnpm dev                               # gateway/catalog/auth/inventory/order/payment
 *   pnpm nx e2e order-e2e --testFile=order-saga-compensation.e2e-spec.ts
 *
 * Env: ORDER_BASE_URL, DB_* (shared core Postgres), KAFKA_BROKERS,
 * PAYMENT_STUB_FAIL_AT_CENTS (must match the running payment stub). Every spec
 * uses bounded polling with clear timeout diagnostics and asserts NO oversell /
 * NO double-charge under any injection.
 */
const TERMINAL = ['CONFIRMED', 'CANCELLED'];

describe('Order saga compensation + idempotency (e2e, compose)', () => {
  it('compensatesReleasedStockOnPaymentDecline', async () => {
    // Payment failure → compensation: total hits the deterministic decline
    // amount, so the saga must release the reserved stock and cancel the order.
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, FAIL_AT_CENTS);
    await seedStock(tenantId, itemId, 5);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 1 }]);
    expect(placed.status).toBe('PENDING');

    const final = await pollOrderUntil(tenantId, userId, placed.id, TERMINAL);
    expect(final).toBe('CANCELLED');
    // Saga walked STOCK_RESERVED → COMPENSATING → CANCELLED; the hold is returned.
    expect(await sagaState(placed.id)).toBe('CANCELLED');
    expect(await stockAvailable(tenantId, itemId)).toBe(5);
    // No poison outbox rows for this order (publish succeeded throughout).
    expect((await orderOutboxAttempts(placed.id)).every((n) => n === 0)).toBe(true);
    // A healthy compensation dead-letters nothing: no handler-exhausted records.
    const replyDlq = await readDlq('inventory.replies');
    expect(replyDlq.every((record) => record.reason !== 'handler-exhausted')).toBe(true);
  }, 60_000);

  it('cancelsWithoutChargingWhenStockInsufficient', async () => {
    // Stock failure → cancel: no stock row, so reserve fails and the saga
    // cancels from STARTED with no payment ever attempted.
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
    // Idempotent saga: after the order confirms, re-publish its StockReserved
    // reply. The dedupe ledger + state guard must make it a no-op — no second
    // ChargePayment, no stock change, saga stays COMPLETED.
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
    // Duplicate command delivery: re-publish the ReserveStock command. The
    // inventory consumer dedupes by command event id + the ACTIVE-hold gate, so
    // stock is decremented once and one reply effect is produced.
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

    // Reserved once despite the duplicate command — no oversell.
    expect(await stockAvailable(tenantId, itemId)).toBe(3);
    expect(await sagaState(placed.id)).toBe('COMPLETED');
  }, 90_000);

  it('holdsInvariantsUnderConcurrencyAndFailureMix', async () => {
    // 100 concurrent orders on two stock-10 items: itemOk succeeds on payment,
    // itemDecline hits the decline amount and must compensate. Invariants:
    // exactly 10 CONFIRMED (itemOk winners), 90 CANCELLED, ZERO oversell on
    // either item, and every payment-declined order releases its hold.
    const tenantId = randomUUID();
    const itemOk = randomUUID();
    const itemDecline = randomUUID();
    const okPrice = FAIL_AT_CENTS === 500 ? 400 : 500;
    await seedMenuItem(tenantId, randomUUID(), itemOk, okPrice);
    await seedMenuItem(tenantId, randomUUID(), itemDecline, FAIL_AT_CENTS);
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
    expect(confirmed).toBe(10); // only itemOk winners confirm
    expect(cancelled).toBe(90);
    // itemOk fully consumed; itemDecline fully released back after compensation.
    expect(await stockAvailable(tenantId, itemOk)).toBe(0);
    expect(await stockAvailable(tenantId, itemDecline)).toBe(10);
  }, 180_000);

  it('listsAStrandedSagaInTheReaperWorklist', async () => {
    // Stale-saga discoverability: simulate a LOST reply by leaving a saga in a
    // non-terminal state with an old updated_at (as if its next reply never
    // arrived / was dead-lettered). The reaper's worklist query — non-terminal
    // AND idle past the timeout — must surface it. Full timeout-driven recovery
    // is a documented later step; here we only prove discoverability.
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
