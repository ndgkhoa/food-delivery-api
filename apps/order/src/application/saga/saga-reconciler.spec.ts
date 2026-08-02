import { randomUUID } from 'node:crypto';
import {
  INVENTORY_COMMANDS_TOPIC,
  PAYMENT_COMMANDS_TOPIC,
} from '@order/application/saga/saga-commands';
import { decideReconcileAction } from '@order/application/saga/saga-reconciler';
import {
  buildOrder,
  DEFAULT_CORRELATION_ID,
  TENANT_ID,
} from '@order/application/saga/saga-reply-test-doubles';
import { OrderSaga, type SagaState } from '@order/domain/saga/order-saga';

const ORDER_ID = '99999999-9999-4999-8999-999999999999';
const MAX_ATTEMPTS = 10;

function sagaIn(state: SagaState, attempts = 0): OrderSaga {
  return OrderSaga.reconstitute({
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    state,
    correlationId: DEFAULT_CORRELATION_ID,
    lastEventId: randomUUID(),
    version: 1,
    attempts,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe('decideReconcileAction', () => {
  it('STARTED re-drives ReserveStock with the order items and the saga correlation id', () => {
    const order = buildOrder(ORDER_ID, 'PENDING');

    const action = decideReconcileAction(sagaIn('STARTED'), order, MAX_ATTEMPTS);

    expect(action).toEqual({
      kind: 'redrive',
      command: {
        aggregateId: ORDER_ID,
        topic: INVENTORY_COMMANDS_TOPIC,
        eventType: 'ReserveStock',
        payload: {
          orderId: ORDER_ID,
          items: order.items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
        },
        correlationId: DEFAULT_CORRELATION_ID,
      },
    });
  });

  it('STOCK_RESERVED re-drives ChargePayment with the order total', () => {
    const order = buildOrder(ORDER_ID, 'RESERVED');

    const action = decideReconcileAction(sagaIn('STOCK_RESERVED'), order, MAX_ATTEMPTS);

    expect(action).toEqual({
      kind: 'redrive',
      command: {
        aggregateId: ORDER_ID,
        topic: PAYMENT_COMMANDS_TOPIC,
        eventType: 'ChargePayment',
        payload: { orderId: ORDER_ID, totalCents: order.totalCents },
        correlationId: DEFAULT_CORRELATION_ID,
      },
    });
  });

  it('COMPENSATING re-drives ReleaseStock', () => {
    const order = buildOrder(ORDER_ID, 'RESERVED');

    const action = decideReconcileAction(sagaIn('COMPENSATING'), order, MAX_ATTEMPTS);

    expect(action).toEqual({
      kind: 'redrive',
      command: {
        aggregateId: ORDER_ID,
        topic: INVENTORY_COMMANDS_TOPIC,
        eventType: 'ReleaseStock',
        payload: { orderId: ORDER_ID },
        correlationId: DEFAULT_CORRELATION_ID,
      },
    });
  });

  it('mints a fresh correlation id only when the saga carries none', () => {
    const saga = OrderSaga.reconstitute({
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      state: 'STARTED',
      correlationId: null,
      lastEventId: null,
      version: 0,
      attempts: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const order = buildOrder(ORDER_ID, 'PENDING');

    const action = decideReconcileAction(saga, order, MAX_ATTEMPTS);

    expect(action.kind).toBe('redrive');
    expect(action.kind === 'redrive' && action.command.correlationId).toEqual(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('escalates once attempts reaches the cap, for any non-terminal state', () => {
    const order = buildOrder(ORDER_ID, 'PENDING');

    expect(decideReconcileAction(sagaIn('STARTED', MAX_ATTEMPTS), order, MAX_ATTEMPTS)).toEqual({
      kind: 'escalate',
    });
    expect(decideReconcileAction(sagaIn('STARTED', MAX_ATTEMPTS + 1), order, MAX_ATTEMPTS)).toEqual(
      {
        kind: 'escalate',
      },
    );
  });

  it('re-drives right up to (but not at) the cap', () => {
    const order = buildOrder(ORDER_ID, 'PENDING');

    const action = decideReconcileAction(sagaIn('STARTED', MAX_ATTEMPTS - 1), order, MAX_ATTEMPTS);

    expect(action.kind).toBe('redrive');
  });

  it('throws defensively for a terminal saga state (should never be reached — selectStrandedSagas excludes it)', () => {
    const order = buildOrder(ORDER_ID, 'CONFIRMED');

    expect(() => decideReconcileAction(sagaIn('COMPLETED'), order, MAX_ATTEMPTS)).toThrow(
      /terminal saga state/,
    );
    expect(() => decideReconcileAction(sagaIn('CANCELLED'), order, MAX_ATTEMPTS)).toThrow(
      /terminal saga state/,
    );
  });
});
