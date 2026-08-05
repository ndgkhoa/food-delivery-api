import { randomUUID } from 'node:crypto';
import {
  HandleInventoryReplyHandler,
  STOCK_RESERVATION_FAILED,
  STOCK_RESERVED,
} from '@order/application/saga/handle-inventory-reply.handler';
import { OrderSaga } from '@order/domain/saga/order-saga';
import { OrderNotFoundError, SagaNotFoundError } from '@order/domain/shared/errors';
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

const STOCK_RELEASED = 'StockReleased';
const UNKNOWN_EVENT_TYPE = 'SomeUnknownReply';

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
      payload: { orderId, totalCents: 2600 },
    });
  });

  it('threads the StockReserved reply correlation id onto the ChargePayment command (one trace per saga)', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

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

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('is a no-op when StockReservationFailed arrives after the saga already moved past STARTED', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(
      OrderSaga.start({ orderId, tenantId: TENANT_ID }).transition('STOCK_RESERVED', randomUUID()),
    );
    orderRepo.seed(buildOrder(orderId, 'RESERVED'));

    await handler.execute(envelope(STOCK_RESERVATION_FAILED, orderId, randomUUID()), { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('on StockReleased: cancels the order and completes the compensation once COMPENSATING', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(
      OrderSaga.start({ orderId, tenantId: TENANT_ID })
        .transition('STOCK_RESERVED', randomUUID())
        .transition('COMPENSATING', randomUUID()),
    );
    orderRepo.seed(buildOrder(orderId, 'RESERVED'));

    await handler.execute(envelope(STOCK_RELEASED, orderId, randomUUID()), { orderId });

    expect(orderRepo.rows.get(orderId)?.status).toBe('CANCELLED');
    expect(sagaRepo.rows.get(orderId)?.state).toBe('CANCELLED');
    expect(outbox.entries[0]).toMatchObject({ topic: 'order.events', eventType: 'OrderCancelled' });
  });

  it('is a no-op when StockReleased arrives outside the COMPENSATING state', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(STOCK_RELEASED, orderId, randomUUID()), { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STARTED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('ignores an unknown inventory reply type', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStarted(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(UNKNOWN_EVENT_TYPE, orderId, randomUUID()), { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STARTED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('throws SagaNotFoundError when no saga exists for the order', async () => {
    const { handler } = buildHandler();
    const orderId = randomUUID();

    await expect(
      handler.execute(envelope(STOCK_RESERVED, orderId, randomUUID()), { orderId }),
    ).rejects.toThrow(SagaNotFoundError);
  });

  it('throws OrderNotFoundError when the saga exists but the order row is missing', async () => {
    const { sagaRepo, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(OrderSaga.start({ orderId, tenantId: TENANT_ID }));

    await expect(
      handler.execute(envelope(STOCK_RESERVED, orderId, randomUUID()), { orderId }),
    ).rejects.toThrow(OrderNotFoundError);
  });
});
