import { MAX_MONEY_CENTS, OrderItem } from '@order/domain/order/order-item';
import { InvalidOrderRequestError } from '@order/domain/shared/errors';

describe('OrderItem', () => {
  it('computes lineTotalCents from qty * unitPriceCents', () => {
    const item = OrderItem.create({ itemId: 'item-1', qty: 3, unitPriceCents: 250 });
    expect(item.itemId).toBe('item-1');
    expect(item.qty).toBe(3);
    expect(item.unitPriceCents).toBe(250);
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

  it('rejects a non-integer unitPriceCents', () => {
    expect(() => OrderItem.create({ itemId: 'item-1', qty: 1, unitPriceCents: 1.5 })).toThrow(
      InvalidOrderRequestError,
    );
  });

  it('rejects a line total exceeding MAX_MONEY_CENTS', () => {
    expect(() =>
      OrderItem.create({ itemId: 'item-1', qty: 2, unitPriceCents: MAX_MONEY_CENTS }),
    ).toThrow(InvalidOrderRequestError);
  });

  it('reconstitutes an item from persisted props without re-deriving lineTotalCents', () => {
    const item = OrderItem.reconstitute({
      itemId: 'item-1',
      qty: 2,
      unitPriceCents: 500,
      lineTotalCents: 1000,
    });
    expect(item.itemId).toBe('item-1');
    expect(item.qty).toBe(2);
    expect(item.unitPriceCents).toBe(500);
    expect(item.lineTotalCents).toBe(1000);
  });
});
