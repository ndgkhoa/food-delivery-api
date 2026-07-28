import {
  PAYMENT_REPLIES_TOPIC,
  paymentFailedReply,
  paymentSucceededReply,
} from './payment-reply-factory';

const orderId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';

describe('payment reply factory', () => {
  it('maps an approved charge to PaymentSucceeded keyed by order id, carrying the command correlation id', () => {
    expect(paymentSucceededReply(orderId, correlationId)).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_REPLIES_TOPIC,
      eventType: 'PaymentSucceeded',
      payload: { orderId },
      correlationId,
    });
  });

  it('maps a declined charge to PaymentFailed with a reason + correlation id', () => {
    expect(paymentFailedReply(orderId, 'declined', correlationId)).toEqual({
      aggregateId: orderId,
      topic: PAYMENT_REPLIES_TOPIC,
      eventType: 'PaymentFailed',
      payload: { orderId, reason: 'declined' },
      correlationId,
    });
  });
});
