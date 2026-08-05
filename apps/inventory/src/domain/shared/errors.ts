import { DomainException } from '@food-delivery-api/shared-errors';

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

export class StockNotFoundError extends DomainException {
  readonly code = 'INVENTORY_STOCK_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly itemId: string) {
    super(`No stock record for item "${itemId}"`);
  }
}

export class InvalidReserveRequestError extends DomainException {
  readonly code = 'INVENTORY_INVALID_RESERVE_REQUEST';
  readonly httpStatus = 400;

  constructor(reason: string) {
    super(`Invalid reserve request: ${reason}`);
  }
}

export class IdempotencyConflictError extends DomainException {
  readonly code = 'INVENTORY_IDEMPOTENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" already has active reservations for different items`);
  }
}
