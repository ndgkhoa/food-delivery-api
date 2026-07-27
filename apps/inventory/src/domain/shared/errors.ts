/**
 * Raised when a reserve would drive an item's available stock below zero — the
 * core no-oversell invariant. Framework-free so the gRPC edge decides how to
 * surface it (here: a non-throwing `ok: false` reserve response).
 */
export class InsufficientStockError extends Error {
  constructor(
    readonly itemId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Insufficient stock for item "${itemId}": requested ${requested}, available ${available}`,
    );
    this.name = 'InsufficientStockError';
  }
}

/** Raised when a reserve references an item that has no stock row in the tenant. */
export class StockNotFoundError extends Error {
  constructor(readonly itemId: string) {
    super(`No stock record for item "${itemId}"`);
    this.name = 'StockNotFoundError';
  }
}

/** Raised when a reserve request is malformed (empty items, non-positive qty). */
export class InvalidReserveRequestError extends Error {
  constructor(reason: string) {
    super(`Invalid reserve request: ${reason}`);
    this.name = 'InvalidReserveRequestError';
  }
}

/**
 * Raised when a reserve replays an orderId that already holds active
 * reservations for a DIFFERENT set of items/quantities — the caller reused an
 * order identity for new contents, which idempotency must reject rather than
 * silently return the old hold. Also covers a concurrent duplicate reserve that
 * the unique index rejects at insert time.
 */
export class IdempotencyConflictError extends Error {
  constructor(readonly orderId: string) {
    super(`Order "${orderId}" already has active reservations for different items`);
    this.name = 'IdempotencyConflictError';
  }
}
