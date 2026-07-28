import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  placeOrder,
  pollOrderUntil,
  sagaState,
  seedMenuItem,
  seedStock,
  stockAvailable,
} from './support/saga-e2e-support';
import { republishRecord } from './support/saga-kafka-support';

/**
 * Compose-based proof that a consumer killed MID-STREAM produces no duplicate
 * side-effects on restart. Same live stack + bring-up as
 * order-saga-compensation.e2e-spec.ts.
 *
 * A crash after the reserve effect applied but BEFORE its offset committed
 * replays the SAME command on restart. The deterministic, in-test proxy for that
 * crash window is to re-publish the already-processed ReserveStock command: an
 * idempotent consumer (dedupe by command event id + the atomic conditional
 * decrement gated on an ACTIVE hold) must apply the reserve exactly once and the
 * saga must still converge to a terminal state.
 *
 * The full process-kill variant (kill the inventory service between reserve and
 * commit, then restart it) is an orchestrated step: `docker compose restart
 * inventory` / kill the dev process after the reserve, then re-run the polling
 * assertions below — the outcome must be identical (no oversell, converges).
 */
const TERMINAL = ['CONFIRMED', 'CANCELLED'];

describe('Order saga idempotency across consumer restart (e2e, compose)', () => {
  it('appliesReserveExactlyOnceWhenTheCommandReplaysAfterACrash', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const itemId = randomUUID();
    await seedMenuItem(tenantId, randomUUID(), itemId, 1500);
    await seedStock(tenantId, itemId, 4);

    const placed = await placeOrder(tenantId, userId, [{ itemId, qty: 3 }]);
    expect(await pollOrderUntil(tenantId, userId, placed.id, TERMINAL)).toBe('CONFIRMED');
    // 4 − 3 reserved once.
    expect(await stockAvailable(tenantId, itemId)).toBe(1);

    // Replay the reserve command as a crash-before-commit redelivery would.
    await republishRecord(
      'inventory.commands',
      (value) => (value as { orderId?: string }).orderId === placed.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    // No double-apply: still 1 available, saga still terminal-complete.
    expect(await stockAvailable(tenantId, itemId)).toBe(1);
    expect(await sagaState(placed.id)).toBe('COMPLETED');
  }, 90_000);
});
