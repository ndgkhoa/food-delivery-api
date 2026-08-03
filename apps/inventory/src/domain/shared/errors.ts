import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Raised when a reserve would drive an item's available stock below zero — the
 * core no-oversell invariant. Inventory's primary surface is gRPC, which maps
 * these via `instanceof` (never through the shared HTTP filter), but they
 * still extend `DomainException` for a consistent error hierarchy and in case
 * a future HTTP surface needs them.
 */
export class InsufficientStockError extends DomainException {
  readonly code = 'INVENTORY_INSUFFICIENT_STOCK';
  readonly httpStatus = 409;

  constructor(
    readonly itemId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Insufficient stock for item "${itemId}": requested ${requested}, available ${available}`,
    );
  }
}

/** Raised when a reserve references an item that has no stock row in the tenant. */
export class StockNotFoundError extends DomainException {
  readonly code = 'INVENTORY_STOCK_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly itemId: string) {
    super(`No stock record for item "${itemId}"`);
  }
}

/** Raised when a reserve request is malformed (empty items, non-positive qty). */
export class InvalidReserveRequestError extends DomainException {
  readonly code = 'INVENTORY_INVALID_RESERVE_REQUEST';
  readonly httpStatus = 400;

  constructor(reason: string) {
    super(`Invalid reserve request: ${reason}`);
  }
}

/**
 * Raised when a reserve replays an orderId that already holds active
 * reservations for a DIFFERENT set of items/quantities — the caller reused an
 * order identity for new contents, which idempotency must reject rather than
 * silently return the old hold. Also covers a concurrent duplicate reserve that
 * the unique index rejects at insert time.
 */
export class IdempotencyConflictError extends DomainException {
  readonly code = 'INVENTORY_IDEMPOTENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" already has active reservations for different items`);
  }
}
