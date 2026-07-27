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
