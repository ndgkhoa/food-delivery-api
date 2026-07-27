import { InsufficientStockError } from '@inventory/domain/shared/errors';
import { Stock } from '@inventory/domain/stock/stock';

const tenantId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';

describe('Stock (no-oversell invariant)', () => {
  it('reserves down to exactly zero', () => {
    const stock = Stock.create({ tenantId, itemId, available: 10 });

    const reserved = stock.reserve(10);

    expect(reserved.available).toBe(0);
  });

  it('reserves a partial quantity, leaving the remainder', () => {
    const stock = Stock.create({ tenantId, itemId, available: 10 });

    expect(stock.reserve(3).available).toBe(7);
  });

  it('never lets available go negative — throws instead', () => {
    const stock = Stock.create({ tenantId, itemId, available: 5 });

    expect(() => stock.reserve(6)).toThrow(InsufficientStockError);
  });

  it('rejects a non-positive reserve quantity', () => {
    const stock = Stock.create({ tenantId, itemId, available: 5 });

    expect(() => stock.reserve(0)).toThrow();
    expect(() => stock.reserve(-1)).toThrow();
  });

  it('returns released units back to available', () => {
    const stock = Stock.create({ tenantId, itemId, available: 2 });

    expect(stock.release(3).available).toBe(5);
  });

  it('is immutable — reserve returns a new instance and leaves the original untouched', () => {
    const stock = Stock.create({ tenantId, itemId, available: 10 });

    const reserved = stock.reserve(4);

    expect(stock.available).toBe(10);
    expect(reserved).not.toBe(stock);
  });

  it('rejects construction with a negative available', () => {
    expect(() => Stock.create({ tenantId, itemId, available: -1 })).toThrow();
  });
});
