import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Transport-agnostic domain errors for the order service. Use cases throw
 * these; the shared `GlobalExceptionFilter` reads `code`/`httpStatus`
 * directly off each, so the domain/application layers never depend on
 * `@nestjs/common` HTTP semantics.
 */

/** Raised when a request is malformed at the use-case boundary (empty items, non-positive qty). */
export class InvalidOrderRequestError extends DomainException {
  readonly code = 'ORDER_INVALID_REQUEST';
  readonly httpStatus = 400;

  constructor(reason: string) {
    super(`Invalid order request: ${reason}`);
  }
}

/** Raised when a tenant-scoped lookup finds no order with the given id. */
export class OrderNotFoundError extends DomainException {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" not found`);
  }
}

/** Raised by `Order`'s state machine when a requested transition is not in the allowed-transitions table. */
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

/**
 * Raised when placing an order references menu items that are missing,
 * belong to another tenant, or are unavailable. Maps to HTTP 422 — the
 * request is well-formed but the referenced items fail business validation.
 */
export class MenuValidationError extends DomainException {
  readonly code = 'ORDER_MENU_VALIDATION_FAILED';
  readonly httpStatus = 422;

  constructor(reason: string) {
    super(`Menu validation failed: ${reason}`);
  }
}

/**
 * Raised when an idempotency key replay cannot be resolved cleanly — either
 * the mapping points at an order row that is not yet visible (a race with the
 * winning concurrent request), or a downstream reserve reports the same
 * order id already holds different reserved contents.
 */
export class IdempotencyConflictError extends DomainException {
  readonly code = 'ORDER_IDEMPOTENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`Idempotency conflict: ${reason}`);
  }
}

/**
 * Raised when an optimistic-lock write loses a race (the row's version no
 * longer matches what was read) or when a downstream gRPC call reports
 * transient contention (ABORTED) that the caller should retry. Maps to HTTP 409.
 */
export class OrderConcurrencyConflictError extends DomainException {
  readonly code = 'ORDER_CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`Concurrent modification conflict: ${reason}`);
  }
}

/** Raised when a caller who is neither the order's owner nor an admin attempts to act on it. */
export class OrderForbiddenError extends DomainException {
  readonly code = 'ORDER_FORBIDDEN';
  readonly httpStatus = 403;

  constructor(readonly orderId: string) {
    super(`Not permitted to act on order "${orderId}"`);
  }
}

/**
 * Raised by the saga state machine when a requested transition is not in its
 * allowed-transitions table (e.g. STOCK_RESERVED→STARTED). Only ever thrown on
 * the Kafka messaging edge (never surfaced over HTTP), but still extends
 * `DomainException` for a consistent error hierarchy across the service.
 */
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

/**
 * Raised when the optimistic-locked saga transition update affects zero rows —
 * a concurrent reply already advanced the saga past the version this handler
 * read. The redelivered/racing reply is safely abandoned.
 */
export class SagaConcurrencyConflictError extends DomainException {
  readonly code = 'ORDER_SAGA_CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Concurrent saga transition conflict for order "${orderId}"`);
  }
}

/** Raised when a reply references an order id that has no saga row (should never happen once place-order committed). */
export class SagaNotFoundError extends DomainException {
  readonly code = 'ORDER_SAGA_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`No saga found for order "${orderId}"`);
  }
}
