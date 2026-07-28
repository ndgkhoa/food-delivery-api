import {
  PAYMENT_REPLIES_TOPIC,
  paymentFailedReply,
  paymentSucceededReply,
} from './payment-reply-factory';

const orderId = '44444444-4444-4444-8444-444444444444';

describe('payment reply factory', () => {
  it('maps an approved charge to PaymentSucceeded keyed by order id', () => {
    expect(paymentSucceededReply(orderId)).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_REPLIES_TOPIC,
      eventType: 'PaymentSucceeded',
      payload: { orderId },
    });
  });

  it('maps a declined charge to PaymentFailed with a reason', () => {
    expect(paymentFailedReply(orderId, 'declined')).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_REPLIES_TOPIC,
      eventType: 'PaymentFailed',
      payload: { orderId, reason: 'declined' },
    });
  });
});
