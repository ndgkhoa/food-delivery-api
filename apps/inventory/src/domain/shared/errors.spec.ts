import {
  IdempotencyConflictError,
  InsufficientStockError,
  InvalidReserveRequestError,
  StockNotFoundError,
} from '@inventory/domain/shared/errors';

const itemId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';

describe('InsufficientStockError', () => {
  it('carries the item, requested, and available quantities', () => {
    const error = new InsufficientStockError(itemId, 5, 2);

    expect(error.code).toBe('INVENTORY_INSUFFICIENT_STOCK');
    expect(error.httpStatus).toBe(409);
    expect(error.itemId).toBe(itemId);
    expect(error.requested).toBe(5);
    expect(error.available).toBe(2);
    expect(error.message).toBe(`Insufficient stock for item "${itemId}": requested 5, available 2`);
    expect(error.name).toBe('InsufficientStockError');
  });
});

describe('StockNotFoundError', () => {
  it('carries the missing item id', () => {
    const error = new StockNotFoundError(itemId);

    expect(error.code).toBe('INVENTORY_STOCK_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(error.itemId).toBe(itemId);
    expect(error.message).toBe(`No stock record for item "${itemId}"`);
  });
});

describe('InvalidReserveRequestError', () => {
  it('embeds the rejection reason in the message', () => {
    const error = new InvalidReserveRequestError('no items to reserve');

    expect(error.code).toBe('INVENTORY_INVALID_RESERVE_REQUEST');
    expect(error.httpStatus).toBe(400);
    expect(error.message).toBe('Invalid reserve request: no items to reserve');
  });
});

describe('IdempotencyConflictError', () => {
  it('carries the conflicting order id', () => {
    const error = new IdempotencyConflictError(orderId);

    expect(error.code).toBe('INVENTORY_IDEMPOTENCY_CONFLICT');
    expect(error.httpStatus).toBe(409);
    expect(error.orderId).toBe(orderId);
    expect(error.message).toBe(
      `Order "${orderId}" already has active reservations for different items`,
    );
  });
});
