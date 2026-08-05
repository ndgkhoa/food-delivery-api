import { bodyFor, subjectFor } from '@notification/domain/notification/notification-copy';

describe('subjectFor', () => {
  it('returns the subject line for an order-confirmed notification', () => {
    expect(subjectFor('order-confirmed')).toBe('Your order is confirmed');
  });

  it('returns the subject line for an order-cancelled notification', () => {
    expect(subjectFor('order-cancelled')).toBe('Your order was cancelled');
  });

  it('throws for an unknown notification type', () => {
    expect(() => subjectFor('unknown-type')).toThrow(
      'No subject template for notification type "unknown-type"',
    );
  });
});

describe('bodyFor', () => {
  it('renders the order-confirmed body with the order id', () => {
    expect(bodyFor('order-confirmed', { orderId: 'order-1' })).toBe(
      'Order order-1 is confirmed. Thanks for ordering!',
    );
  });

  it('renders the order-confirmed body with an empty id when missing', () => {
    expect(bodyFor('order-confirmed', {})).toBe('Order  is confirmed. Thanks for ordering!');
  });

  it('renders the order-cancelled body with the order id', () => {
    expect(bodyFor('order-cancelled', { orderId: 'order-2' })).toBe('Order order-2 was cancelled.');
  });

  it('throws for an unknown notification type', () => {
    expect(() => bodyFor('unknown-type', {})).toThrow(
      'No body template for notification type "unknown-type"',
    );
  });
});
