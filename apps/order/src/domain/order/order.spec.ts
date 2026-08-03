import { Order } from '@order/domain/order/order';
import { MAX_MONEY_CENTS, OrderItem } from '@order/domain/order/order-item';
import { IllegalOrderTransitionError, InvalidOrderRequestError } from '@order/domain/shared/errors';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const restaurantId = '44444444-4444-4444-8444-444444444444';

/** Matches the config service's documented defaults (order.delivery_fee_cents / vat_rate_bps / discount_cents). */
const defaultPricing = { deliveryFeeCents: 1500, vatRateBps: 1000, discountCents: 0 };

function buildOrder(): Order {
  const item = OrderItem.create({ itemId, qty: 2, unitPriceCents: 1000 });
  return Order.create({
    id: 'order-1',
    tenantId,
    userId,
    restaurantId,
    items: [item],
    pricing: defaultPricing,
  });
}

describe('Order', () => {
  describe('create', () => {
    it('starts PENDING with subtotal from line items and total = subtotal + fee + VAT - discount', () => {
      const order = buildOrder();
      expect(order.status).toBe('PENDING');
      expect(order.subtotalCents).toBe(2000);
      expect(order.deliveryFeeCents).toBe(1500);
      expect(order.vatCents).toBe(200); // floor(2000 * 1000 / 10000)
      expect(order.discountCents).toBe(0);
      expect(order.totalCents).toBe(3700); // 2000 + 1500 + 200 - 0
      expect(order.version).toBe(0);
      expect(order.restaurantId).toBe(restaurantId);
    });

    it('rejects a missing restaurantId', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId: '',
          items: [item],
          pricing: defaultPricing,
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('rejects an empty item list', () => {
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [],
          pricing: defaultPricing,
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('sums multiple line items into the subtotal before applying pricing', () => {
      const itemA = OrderItem.create({ itemId, qty: 2, unitPriceCents: 1000 });
      const itemB = OrderItem.create({ itemId: 'other-item', qty: 3, unitPriceCents: 500 });
      const order = Order.create({
        id: 'order-1',
        tenantId,
        userId,
        restaurantId,
        items: [itemA, itemB],
        pricing: defaultPricing,
      });
      expect(order.subtotalCents).toBe(2000 + 1500);
      expect(order.vatCents).toBe(350); // floor(3500 * 1000 / 10000)
      expect(order.totalCents).toBe(3500 + 1500 + 350);
    });

    it('floors VAT down rather than rounding to the nearest cent', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 999 });
      const order = Order.create({
        id: 'order-1',
        tenantId,
        userId,
        restaurantId,
        items: [item],
        pricing: { deliveryFeeCents: 0, vatRateBps: 1000, discountCents: 0 },
      });
      // 999 * 1000 / 10000 = 99.9 -> floors to 99, never rounds up to 100.
      expect(order.vatCents).toBe(99);
      expect(order.totalCents).toBe(999 + 99);
    });

    it('floors the total at 0 when the discount exceeds subtotal + fee + VAT', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      const order = Order.create({
        id: 'order-1',
        tenantId,
        userId,
        restaurantId,
        items: [item],
        pricing: { deliveryFeeCents: 0, vatRateBps: 0, discountCents: 1_000_000 },
      });
      expect(order.subtotalCents).toBe(100);
      expect(order.totalCents).toBe(0);
    });

    it('rejects a negative delivery fee', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [item],
          pricing: { deliveryFeeCents: -1, vatRateBps: 1000, discountCents: 0 },
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('rejects a negative VAT rate', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [item],
          pricing: { deliveryFeeCents: 0, vatRateBps: -1, discountCents: 0 },
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('rejects a non-integer discount (e.g. NaN)', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [item],
          pricing: { deliveryFeeCents: 0, vatRateBps: 0, discountCents: Number.NaN },
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('rejects a fee exceeding MAX_MONEY_CENTS even when a large discount nets the total back in range', () => {
      // A fee + discount that both exceed the int4 money-column ceiling but cancel
      // to an in-range total must NOT slip past a total-only guard and overflow
      // its column on insert — each component is bounded independently.
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [item],
          pricing: {
            deliveryFeeCents: MAX_MONEY_CENTS + 1_000,
            vatRateBps: 0,
            discountCents: MAX_MONEY_CENTS + 1_000,
          },
        }),
      ).toThrow(InvalidOrderRequestError);
    });

    it('rejects a total exceeding MAX_MONEY_CENTS even when every line item is within range', () => {
      const item = OrderItem.create({ itemId, qty: 1, unitPriceCents: MAX_MONEY_CENTS - 100 });
      expect(() =>
        Order.create({
          id: 'order-1',
          tenantId,
          userId,
          restaurantId,
          items: [item],
          pricing: { deliveryFeeCents: 1000, vatRateBps: 0, discountCents: 0 },
        }),
      ).toThrow(InvalidOrderRequestError);
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
