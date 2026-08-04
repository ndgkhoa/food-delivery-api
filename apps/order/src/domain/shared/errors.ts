import { DomainException } from '@food-delivery-api/shared-errors';

export class InvalidOrderRequestError extends DomainException {
  readonly code = 'ORDER_INVALID_REQUEST';
  readonly httpStatus = 400;

  constructor(reason: string) {
    super(`Invalid order request: ${reason}`);
  }
}

export class OrderNotFoundError extends DomainException {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" not found`);
  }
}

export class IllegalOrderTransitionError extends DomainException {
  readonly code = 'ORDER_ILLEGAL_TRANSITION';
  readonly httpStatus = 409;

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal order transition from "${from}" to "${to}"`);
  }
}

export class MenuValidationError extends DomainException {
  readonly code = 'ORDER_MENU_VALIDATION_FAILED';
  readonly httpStatus = 422;

  constructor(reason: string) {
    super(`Menu validation failed: ${reason}`);
  }
}

export class IdempotencyConflictError extends DomainException {
  readonly code = 'ORDER_IDEMPOTENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`Idempotency conflict: ${reason}`);
  }
}

export class OrderConcurrencyConflictError extends DomainException {
  readonly code = 'ORDER_CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`Concurrent modification conflict: ${reason}`);
  }
}

export class OrderForbiddenError extends DomainException {
  readonly code = 'ORDER_FORBIDDEN';
  readonly httpStatus = 403;

  constructor(readonly orderId: string) {
    super(`Not permitted to act on order "${orderId}"`);
  }
}

export class IllegalSagaTransitionError extends DomainException {
  readonly code = 'ORDER_SAGA_ILLEGAL_TRANSITION';
  readonly httpStatus = 409;

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal saga transition from "${from}" to "${to}"`);
  }
}

export class SagaConcurrencyConflictError extends DomainException {
  readonly code = 'ORDER_SAGA_CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Concurrent saga transition conflict for order "${orderId}"`);
  }
}

export class SagaNotFoundError extends DomainException {
  readonly code = 'ORDER_SAGA_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`No saga found for order "${orderId}"`);
  }
}

export class SagaStateChangedError extends DomainException {
  readonly code = 'ORDER_SAGA_STATE_CHANGED';
  readonly httpStatus = 409;

  constructor(
    readonly orderId: string,
    readonly expectedState: string,
  ) {
    super(`Saga for order "${orderId}" is no longer in state "${expectedState}"`);
  }
}
