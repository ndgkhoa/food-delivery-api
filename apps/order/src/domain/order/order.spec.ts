import { Order } from '@order/domain/order/order';
import { OrderItem } from '@order/domain/order/order-item';
import { IllegalOrderTransitionError, InvalidOrderRequestError } from '@order/domain/shared/errors';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

function buildOrder(): Order {
  const item = OrderItem.create({ itemId, qty: 2, unitPriceCents: 1000 });
  return Order.create({ id: 'order-1', tenantId, userId, items: [item] });
}

describe('Order', () => {
  describe('create', () => {
    it('starts PENDING with total computed from line items', () => {
      const order = buildOrder();
      expect(order.status).toBe('PENDING');
      expect(order.totalCents).toBe(2000);
      expect(order.version).toBe(0);
    });

    it('rejects an empty item list', () => {
      expect(() => Order.create({ id: 'order-1', tenantId, userId, items: [] })).toThrow(
        InvalidOrderRequestError,
      );
    });

    it('sums multiple line items into the total', () => {
      const itemA = OrderItem.create({ itemId, qty: 2, unitPriceCents: 1000 });
      const itemB = OrderItem.create({ itemId: 'other-item', qty: 3, unitPriceCents: 500 });
      const order = Order.create({ id: 'order-1', tenantId, userId, items: [itemA, itemB] });
      expect(order.totalCents).toBe(2000 + 1500);
    });
  });

  describe('state machine', () => {
    it('allows PENDING -> RESERVED', () => {
      const order = buildOrder();
      const reserved = order.reserve();
      expect(reserved.status).toBe('RESERVED');
      expect(reserved).not.toBe(order);
      expect(order.status).toBe('PENDING'); // original is untouched (immutable transition)
    });

    it('allows PENDING -> CANCELLED', () => {
      const cancelled = buildOrder().cancel();
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('allows RESERVED -> CONFIRMED', () => {
      const confirmed = buildOrder().reserve().confirm();
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('allows RESERVED -> CANCELLED', () => {
      const cancelled = buildOrder().reserve().cancel();
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('rejects PENDING -> CONFIRMED', () => {
      expect(() => buildOrder().confirm()).toThrow(IllegalOrderTransitionError);
    });

    it('rejects CONFIRMED -> CANCELLED (terminal state)', () => {
      const confirmed = buildOrder().reserve().confirm();
      expect(() => confirmed.cancel()).toThrow(IllegalOrderTransitionError);
    });

    it('rejects CANCELLED -> RESERVED (terminal state)', () => {
      const cancelled = buildOrder().cancel();
      expect(() => cancelled.reserve()).toThrow(IllegalOrderTransitionError);
    });

    it('rejects re-reserving an already-RESERVED order', () => {
      const reserved = buildOrder().reserve();
      expect(() => reserved.reserve()).toThrow(IllegalOrderTransitionError);
    });
  });

  describe('isOwnedBy', () => {
    it('returns true for the order owner and false otherwise', () => {
      const order = buildOrder();
      expect(order.isOwnedBy(userId)).toBe(true);
      expect(order.isOwnedBy('someone-else')).toBe(false);
    });
  });
});
