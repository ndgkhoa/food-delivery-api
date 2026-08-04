import { randomUUID } from 'node:crypto';
import { OrderSaga } from '@order/domain/saga/order-saga';
import {
  buildOrder,
  DEFAULT_CORRELATION_ID,
  envelope,
  FakeOrderRepository,
  FakeOutboxWriter,
  FakeProcessedEventStore,
  FakeSagaRepository,
  FakeTransaction,
  TENANT_ID,
  USER_ID,
} from '@order/testing/saga-reply-test-doubles';
import {
  HandleInventoryReplyHandler,
  STOCK_RESERVATION_FAILED,
  STOCK_RESERVED,
} from './handle-inventory-reply.handler';

function buildHandler() {
  const sagaRepo = new FakeSagaRepository();
  const orderRepo = new FakeOrderRepository();
  const outbox = new FakeOutboxWriter();
  const processed = new FakeProcessedEventStore();
  const handler = new HandleInventoryReplyHandler(
    sagaRepo,
    orderRepo,
    outbox,
    processed,
    new FakeTransaction(),
  );
  return { sagaRepo, orderRepo, outbox, handler };
}

function seedStarted(
  sagaRepo: FakeSagaRepository,
  orderRepo: FakeOrderRepository,
  orderId: string,
) {
  sagaRepo.seed(OrderSaga.start({ orderId, tenantId: TENANT_ID }));
  orderRepo.seed(buildOrder(orderId, 'PENDING'));
}

describe('HandleInventoryReplyHandler', () => {
  it('on StockReserved: reserves the order, advances the saga, and enqueues ChargePayment', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(STOCK_RESERVED, orderId, randomUUID()), { orderId });

    expect(orderRepo.rows.get(orderId)?.status).toBe('RESERVED');
    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      topic: 'payment.commands',
      eventType: 'ChargePayment',
      // subtotal 1000 (2 x 500) + DEFAULT_PRICING (fee 1500, vat floor(1000*1000/10000)=100).
      payload: { orderId, totalCents: 2600 },
    });
  });

  it('threads the StockReserved reply correlation id onto the ChargePayment command (one trace per saga)', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

    // The reply carries the saga's root correlation id (minted at place-order and
    // carried by inventory onto StockReserved); it must ride the next command.
    await handler.execute(envelope(STOCK_RESERVED, orderId, randomUUID()), { orderId });

    expect(outbox.entries[0].correlationId).toBe(DEFAULT_CORRELATION_ID);
  });

  it('on StockReservationFailed: cancels the order and the saga, emits OrderCancelled (no further command)', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(STOCK_RESERVATION_FAILED, orderId, randomUUID()), {
      orderId,
      reason: 'no stock',
    });

    expect(orderRepo.rows.get(orderId)?.status).toBe('CANCELLED');
    expect(sagaRepo.rows.get(orderId)?.state).toBe('CANCELLED');
    // The only outbox row is the lifecycle event — no compensating command from here.
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      topic: 'order.events',
      eventType: 'OrderCancelled',
      payload: { orderId, userId: USER_ID, status: 'CANCELLED', totalCents: 2600 },
    });
  });

  it('is a no-op on a re-delivered reply (same event id) — no double transition', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);
    const reply = envelope(STOCK_RESERVED, orderId, randomUUID());

    await handler.execute(reply, { orderId });
    await handler.execute(reply, { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(1);
  });

  it('is a no-op when a fresh StockReserved arrives but the saga already moved past STARTED', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(
      OrderSaga.start({ orderId, tenantId: TENANT_ID }).transition('STOCK_RESERVED', randomUUID()),
    );
    orderRepo.seed(buildOrder(orderId, 'RESERVED'));

    await handler.execute(envelope(STOCK_RESERVED, orderId, randomUUID()), { orderId });

    // State unchanged and no duplicate ChargePayment enqueued.
    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(0);
  });
});
