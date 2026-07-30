import { parseEligibleOrder } from '@review/application/parse-eligible-order';

describe('parseEligibleOrder', () => {
  it('extracts the eligible-order fields from a well-formed payload', () => {
    const result = parseEligibleOrder({
      orderId: 'order-1',
      userId: 'user-1',
      restaurantId: 'restaurant-1',
    });

    expect(result).toEqual({ orderId: 'order-1', userId: 'user-1', restaurantId: 'restaurant-1' });
  });

  it('skips a straggler order confirmed without a restaurantId', () => {
    expect(parseEligibleOrder({ orderId: 'order-1', userId: 'user-1' })).toBeNull();
  });

  it('skips a payload missing orderId', () => {
    expect(parseEligibleOrder({ userId: 'user-1', restaurantId: 'restaurant-1' })).toBeNull();
  });

  it('skips a payload missing userId', () => {
    expect(parseEligibleOrder({ orderId: 'order-1', restaurantId: 'restaurant-1' })).toBeNull();
  });
});
