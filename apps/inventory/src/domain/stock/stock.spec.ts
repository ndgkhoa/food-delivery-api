import { Stock } from '@inventory/domain/stock/stock';

const tenantId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';

describe('Stock (read model)', () => {
  it('exposes its natural key and available units', () => {
    const stock = Stock.create({ tenantId, itemId, available: 10 });

    expect(stock.tenantId).toBe(tenantId);
    expect(stock.itemId).toBe(itemId);
    expect(stock.available).toBe(10);
  });

  it('rejects construction with a negative available', () => {
    expect(() => Stock.create({ tenantId, itemId, available: -1 })).toThrow();
  });

  it('rejects construction with a non-integer available', () => {
    expect(() => Stock.create({ tenantId, itemId, available: 1.5 })).toThrow();
  });

  it('rehydrates already-validated persistence data', () => {
    const stock = Stock.reconstitute({ tenantId, itemId, available: 3 });

    expect(stock.available).toBe(3);
  });
});
