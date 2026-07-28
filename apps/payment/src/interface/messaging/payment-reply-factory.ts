import type { OutboxCommandEntry } from '@payment/domain/shared/outbox.port';

/** Topic payment publishes saga replies to (keyed by order id). */
export const PAYMENT_REPLIES_TOPIC = 'payment.replies';

/** Command event type payment consumes on `payment.commands`. */
export const CHARGE_PAYMENT = 'ChargePayment';

/** Reply event types payment emits on `payment.replies`. */
const PAYMENT_SUCCEEDED = 'PaymentSucceeded';
const PAYMENT_FAILED = 'PaymentFailed';

export function paymentSucceededReply(orderId: string, correlationId: string): OutboxCommandEntry {
  return {
    aggregateId: orderId,
    topic: PAYMENT_REPLIES_TOPIC,
    eventType: PAYMENT_SUCCEEDED,
    payload: { orderId },
    // Carry the ChargePayment command's correlation id so the saga shares one trace id.
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
