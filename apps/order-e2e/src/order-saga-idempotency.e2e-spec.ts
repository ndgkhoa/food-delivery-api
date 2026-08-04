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
    expect(await stockAvailable(tenantId, itemId)).toBe(1);

    await republishRecord(
      'inventory.commands',
      (value) => (value as { orderId?: string }).orderId === placed.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(await stockAvailable(tenantId, itemId)).toBe(1);
    expect(await sagaState(placed.id)).toBe('COMPLETED');
  }, 90_000);
});
