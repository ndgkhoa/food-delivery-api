import type { OutboxCommandEntry } from '@payment/domain/shared/outbox.port';

export const PAYMENT_REPLIES_TOPIC = 'payment.replies';

export const CHARGE_PAYMENT = 'ChargePayment';

const PAYMENT_SUCCEEDED = 'PaymentSucceeded';
const PAYMENT_FAILED = 'PaymentFailed';

export function paymentSucceededReply(orderId: string, correlationId: string): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: PAYMENT_REPLIES_TOPIC,
    eventType: PAYMENT_SUCCEEDED,
    payload: { orderId },
    correlationId,
  };
}

export function paymentFailedReply(
  orderId: string,
  reason: string,
  correlationId: string,
): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: PAYMENT_REPLIES_TOPIC,
    eventType: PAYMENT_FAILED,
    payload: { orderId, reason },
    correlationId,
  };
}
