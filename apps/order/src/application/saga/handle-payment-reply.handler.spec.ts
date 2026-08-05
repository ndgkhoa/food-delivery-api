import { randomUUID } from 'node:crypto';
import {
  HandlePaymentReplyHandler,
  PAYMENT_FAILED,
  PAYMENT_SUCCEEDED,
} from '@order/application/saga/handle-payment-reply.handler';
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
  RESTAURANT_ID,
  TENANT_ID,
  USER_ID,
} from '@order/testing/saga-reply-test-doubles';

function buildHandler() {
  const sagaRepo = new FakeSagaRepository();
  const orderRepo = new FakeOrderRepository();
  const outbox = new FakeOutboxWriter();
  const processed = new FakeProcessedEventStore();
  const handler = new HandlePaymentReplyHandler(
    sagaRepo,
    orderRepo,
    outbox,
    processed,
    new FakeTransaction(),
  );
  return { sagaRepo, orderRepo, outbox, handler };
}

function seedStockReserved(
  sagaRepo: FakeSagaRepository,
  orderRepo: FakeOrderRepository,
  orderId: string,
) {
  sagaRepo.seed(
    OrderSaga.start({ orderId, tenantId: TENANT_ID }).transition('STOCK_RESERVED', randomUUID()),
  );
  orderRepo.seed(buildOrder(orderId, 'RESERVED'));
}

describe('HandlePaymentReplyHandler', () => {
  it('on PaymentSucceeded: confirms the order, completes the saga, and emits OrderConfirmed', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStockReserved(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(PAYMENT_SUCCEEDED, orderId, randomUUID()), { orderId });

    expect(orderRepo.rows.get(orderId)?.status).toBe('CONFIRMED');
    expect(sagaRepo.rows.get(orderId)?.state).toBe('COMPLETED');
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      topic: 'order.events',
      eventType: 'OrderConfirmed',
      payload: {
        orderId,
        userId: USER_ID,
        restaurantId: RESTAURANT_ID,
        status: 'CONFIRMED',
        totalCents: 2600,
      },
    });
    expect(outbox.entries[0].correlationId).toBe(DEFAULT_CORRELATION_ID);
  });

  it('on PaymentFailed: begins compensation (COMPENSATING + ReleaseStock), order stays RESERVED', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStockReserved(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope(PAYMENT_FAILED, orderId, randomUUID()), {
      orderId,
      reason: 'declined',
    });

    expect(orderRepo.rows.get(orderId)?.status).toBe('RESERVED');
    expect(sagaRepo.rows.get(orderId)?.state).toBe('COMPENSATING');
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({
      topic: 'inventory.commands',
      eventType: 'ReleaseStock',
      payload: { orderId },
    });
    expect(outbox.entries[0].correlationId).toBe(DEFAULT_CORRELATION_ID);
  });

  it('is a no-op on a re-delivered PaymentSucceeded — no double confirm', async () => {
    const { sagaRepo, orderRepo, handler } = buildHandler();
    const orderId = randomUUID();
    seedStockReserved(sagaRepo, orderRepo, orderId);
    const reply = envelope(PAYMENT_SUCCEEDED, orderId, randomUUID());

    await handler.execute(reply, { orderId });
    await handler.execute(reply, { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('COMPLETED');
    expect(orderRepo.rows.get(orderId)?.status).toBe('CONFIRMED');
  });

  it('ignores a payment reply that arrives after the saga already completed', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(
      OrderSaga.start({ orderId, tenantId: TENANT_ID })
        .transition('STOCK_RESERVED', randomUUID())
        .transition('COMPLETED', randomUUID()),
    );
    orderRepo.seed(buildOrder(orderId, 'CONFIRMED'));

    await handler.execute(envelope(PAYMENT_FAILED, orderId, randomUUID()), { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('COMPLETED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('ignores an unknown payment reply type', async () => {
    const { sagaRepo, orderRepo, outbox, handler } = buildHandler();
    const orderId = randomUUID();
    seedStockReserved(sagaRepo, orderRepo, orderId);

    await handler.execute(envelope('SomeUnknownReply', orderId, randomUUID()), { orderId });

    expect(sagaRepo.rows.get(orderId)?.state).toBe('STOCK_RESERVED');
    expect(outbox.entries).toHaveLength(0);
  });

  it('throws SagaNotFoundError when no saga exists for the order', async () => {
    const { handler } = buildHandler();
    const orderId = randomUUID();

    await expect(
      handler.execute(envelope(PAYMENT_SUCCEEDED, orderId, randomUUID()), { orderId }),
    ).rejects.toThrow(SagaNotFoundError);
  });

  it('throws OrderNotFoundError when the saga is STOCK_RESERVED but the order row is missing', async () => {
    const { sagaRepo, handler } = buildHandler();
    const orderId = randomUUID();
    sagaRepo.seed(
      OrderSaga.start({ orderId, tenantId: TENANT_ID }).transition('STOCK_RESERVED', randomUUID()),
    );

    await expect(
      handler.execute(envelope(PAYMENT_SUCCEEDED, orderId, randomUUID()), { orderId }),
    ).rejects.toThrow(OrderNotFoundError);
  });
});
