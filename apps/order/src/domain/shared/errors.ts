/**
 * Transport-agnostic domain errors for the order service. Use cases throw
 * these; the HTTP filter (interface layer) maps each to a status code so the
 * domain/application layers never depend on `@nestjs/common` HTTP semantics.
 */

/** Raised when a request is malformed at the use-case boundary (empty items, non-positive qty). */
export class InvalidOrderRequestError extends Error {
  constructor(reason: string) {
    super(`Invalid order request: ${reason}`);
    this.name = 'InvalidOrderRequestError';
  }
}

/** Raised when a tenant-scoped lookup finds no order with the given id. */
export class OrderNotFoundError extends Error {
  constructor(readonly orderId: string) {
    super(`Order "${orderId}" not found`);
    this.name = 'OrderNotFoundError';
  }
}

/** Raised by `Order`'s state machine when a requested transition is not in the allowed-transitions table. */
export class IllegalOrderTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal order transition from "${from}" to "${to}"`);
    this.name = 'IllegalOrderTransitionError';
  }
}

/**
 * Raised when placing an order references menu items that are missing,
 * belong to another tenant, or are unavailable. Framework-free so the HTTP
 * edge decides the status code (422 — the request is well-formed but the
 * referenced items fail business validation).
 */
export class MenuValidationError extends Error {
  constructor(reason: string) {
    super(`Menu validation failed: ${reason}`);
    this.name = 'MenuValidationError';
  }
}

/** Raised when inventory reports it could not reserve the full requested quantity for an order. */
export class InsufficientStockError extends Error {
  constructor(readonly orderId: string) {
    super(`Insufficient stock to reserve order "${orderId}"`);
    this.name = 'InsufficientStockError';
  }
}

/**
 * Raised when an idempotency key replay cannot be resolved cleanly — either
 * the mapping points at an order row that is not yet visible (a race with the
 * winning concurrent request), or a downstream reserve reports the same
 * order id already holds different reserved contents.
 */
export class IdempotencyConflictError extends Error {
  constructor(reason: string) {
    super(`Idempotency conflict: ${reason}`);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * Raised when an optimistic-lock write loses a race (the row's version no
 * longer matches what was read) or when a downstream gRPC call reports
 * transient contention (ABORTED) that the caller should retry. Maps to HTTP 409.
 */
export class OrderConcurrencyConflictError extends Error {
  constructor(reason: string) {
    super(`Concurrent modification conflict: ${reason}`);
    this.name = 'OrderConcurrencyConflictError';
  }
}

/** Raised when a caller who is neither the order's owner nor an admin attempts to act on it. */
export class OrderForbiddenError extends Error {
  constructor(readonly orderId: string) {
    super(`Not permitted to act on order "${orderId}"`);
    this.name = 'OrderForbiddenError';
  }
}

/**
 * Raised by the saga state machine when a requested transition is not in its
 * allowed-transitions table (e.g. STOCK_RESERVED→STARTED). Framework-free so
 * the messaging edge decides whether to retry or skip.
 */
export class IllegalSagaTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal saga transition from "${from}" to "${to}"`);
    this.name = 'IllegalSagaTransitionError';
  }
}

/**
 * Raised when the optimistic-locked saga transition update affects zero rows —
 * a concurrent reply already advanced the saga past the version this handler
 * read. The redelivered/racing reply is safely abandoned.
 */
export class SagaConcurrencyConflictError extends Error {
  constructor(readonly orderId: string) {
    super(`Concurrent saga transition conflict for order "${orderId}"`);
    this.name = 'SagaConcurrencyConflictError';
  }
}

/** Raised when a reply references an order id that has no saga row (should never happen once place-order committed). */
export class SagaNotFoundError extends Error {
  constructor(readonly orderId: string) {
    super(`No saga found for order "${orderId}"`);
    this.name = 'SagaNotFoundError';
  }
}
