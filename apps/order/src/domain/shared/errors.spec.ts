import {
  IdempotencyConflictError,
  IllegalOrderTransitionError,
  IllegalSagaTransitionError,
  InvalidOrderRequestError,
  MenuValidationError,
  OrderConcurrencyConflictError,
  OrderForbiddenError,
  OrderNotFoundError,
  SagaConcurrencyConflictError,
  SagaNotFoundError,
  SagaStateChangedError,
} from '@order/domain/shared/errors';

describe('InvalidOrderRequestError', () => {
  it('carries the ORDER_INVALID_REQUEST code, 400 status, and the reason in its message', () => {
    const error = new InvalidOrderRequestError('quantity must be positive');
    expect(error.code).toBe('ORDER_INVALID_REQUEST');
    expect(error.httpStatus).toBe(400);
    expect(error.message).toBe('Invalid order request: quantity must be positive');
  });
});

describe('OrderNotFoundError', () => {
  it('carries the ORDER_NOT_FOUND code, 404 status, and the order id', () => {
    const error = new OrderNotFoundError('order-1');
    expect(error.code).toBe('ORDER_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(error.orderId).toBe('order-1');
    expect(error.message).toBe('Order "order-1" not found');
  });
});

describe('IllegalOrderTransitionError', () => {
  it('carries the ORDER_ILLEGAL_TRANSITION code, 409 status, and the from/to states', () => {
    const error = new IllegalOrderTransitionError('CONFIRMED', 'CANCELLED');
    expect(error.code).toBe('ORDER_ILLEGAL_TRANSITION');
    expect(error.httpStatus).toBe(409);
    expect(error.from).toBe('CONFIRMED');
    expect(error.to).toBe('CANCELLED');
    expect(error.message).toBe('Illegal order transition from "CONFIRMED" to "CANCELLED"');
  });
});

describe('MenuValidationError', () => {
  it('carries the ORDER_MENU_VALIDATION_FAILED code, 422 status, and the reason', () => {
    const error = new MenuValidationError('item not found');
    expect(error.code).toBe('ORDER_MENU_VALIDATION_FAILED');
    expect(error.httpStatus).toBe(422);
    expect(error.message).toBe('Menu validation failed: item not found');
  });
});

describe('IdempotencyConflictError', () => {
  it('carries the ORDER_IDEMPOTENCY_CONFLICT code, 409 status, and the reason', () => {
    const error = new IdempotencyConflictError('order is being created');
    expect(error.code).toBe('ORDER_IDEMPOTENCY_CONFLICT');
    expect(error.httpStatus).toBe(409);
    expect(error.message).toBe('Idempotency conflict: order is being created');
  });
});

describe('OrderConcurrencyConflictError', () => {
  it('carries the ORDER_CONCURRENCY_CONFLICT code, 409 status, and the reason', () => {
    const error = new OrderConcurrencyConflictError('order-1');
    expect(error.code).toBe('ORDER_CONCURRENCY_CONFLICT');
    expect(error.httpStatus).toBe(409);
    expect(error.message).toBe('Concurrent modification conflict: order-1');
  });
});

describe('OrderForbiddenError', () => {
  it('carries the ORDER_FORBIDDEN code, 403 status, and the order id', () => {
    const error = new OrderForbiddenError('order-1');
    expect(error.code).toBe('ORDER_FORBIDDEN');
    expect(error.httpStatus).toBe(403);
    expect(error.orderId).toBe('order-1');
    expect(error.message).toBe('Not permitted to act on order "order-1"');
  });
});

describe('IllegalSagaTransitionError', () => {
  it('carries the ORDER_SAGA_ILLEGAL_TRANSITION code, 409 status, and the from/to states', () => {
    const error = new IllegalSagaTransitionError('STARTED', 'COMPLETED');
    expect(error.code).toBe('ORDER_SAGA_ILLEGAL_TRANSITION');
    expect(error.httpStatus).toBe(409);
    expect(error.from).toBe('STARTED');
    expect(error.to).toBe('COMPLETED');
    expect(error.message).toBe('Illegal saga transition from "STARTED" to "COMPLETED"');
  });
});

describe('SagaConcurrencyConflictError', () => {
  it('carries the ORDER_SAGA_CONCURRENCY_CONFLICT code, 409 status, and the order id', () => {
    const error = new SagaConcurrencyConflictError('order-1');
    expect(error.code).toBe('ORDER_SAGA_CONCURRENCY_CONFLICT');
    expect(error.httpStatus).toBe(409);
    expect(error.orderId).toBe('order-1');
    expect(error.message).toBe('Concurrent saga transition conflict for order "order-1"');
  });
});

describe('SagaNotFoundError', () => {
  it('carries the ORDER_SAGA_NOT_FOUND code, 404 status, and the order id', () => {
    const error = new SagaNotFoundError('order-1');
    expect(error.code).toBe('ORDER_SAGA_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(error.orderId).toBe('order-1');
    expect(error.message).toBe('No saga found for order "order-1"');
  });
});

describe('SagaStateChangedError', () => {
  it('carries the ORDER_SAGA_STATE_CHANGED code, 409 status, and the order id/expected state', () => {
    const error = new SagaStateChangedError('order-1', 'STARTED');
    expect(error.code).toBe('ORDER_SAGA_STATE_CHANGED');
    expect(error.httpStatus).toBe(409);
    expect(error.orderId).toBe('order-1');
    expect(error.expectedState).toBe('STARTED');
    expect(error.message).toBe('Saga for order "order-1" is no longer in state "STARTED"');
  });
});
