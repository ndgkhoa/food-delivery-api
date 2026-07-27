import { OrderItem } from '@order/domain/order/order-item';
import { InvalidOrderRequestError } from '@order/domain/shared/errors';

describe('OrderItem', () => {
  it('computes lineTotalCents from qty * unitPriceCents', () => {
    const item = OrderItem.create({ itemId: 'item-1', qty: 3, unitPriceCents: 250 });
    expect(item.lineTotalCents).toBe(750);
  });

  it('rejects a zero qty', () => {
    expect(() => OrderItem.create({ itemId: 'item-1', qty: 0, unitPriceCents: 250 })).toThrow(
      InvalidOrderRequestError,
    );
  });

  it('rejects a negative qty', () => {
    expect(() => OrderItem.create({ itemId: 'item-1', qty: -1, unitPriceCents: 250 })).toThrow(
      InvalidOrderRequestError,
    );
  });

  it('rejects a non-integer qty', () => {
    expect(() => OrderItem.create({ itemId: 'item-1', qty: 1.5, unitPriceCents: 250 })).toThrow(
      InvalidOrderRequestError,
    );
  });

  it('rejects a negative unitPriceCents', () => {
    expect(() => OrderItem.create({ itemId: 'item-1', qty: 1, unitPriceCents: -1 })).toThrow(
      InvalidOrderRequestError,
    );
  });

  it('accepts a zero unitPriceCents (free item)', () => {
    const item = OrderItem.create({ itemId: 'item-1', qty: 2, unitPriceCents: 0 });
    expect(item.lineTotalCents).toBe(0);
  });
});
