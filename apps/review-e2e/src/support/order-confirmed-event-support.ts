import { randomUUID } from 'node:crypto';
import {
  createKafkaClient,
  encodeHeaders,
  type KafkaClient,
} from '@food-delivery-api/shared-messaging';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const ORDER_EVENTS_TOPIC = 'order.events';
const ORDER_CONFIRMED = 'OrderConfirmed';

export interface OrderConfirmedEvent {
  orderId: string;
  userId: string;
  restaurantId: string;
  tenantId: string;
}

/**
 * Produces an `OrderConfirmed` directly to `order.events` with the six
 * envelope headers the review consumer requires, matching order's real
 * producer payload shape (`orderId`, `userId`, `status`, `totalCents`,
 * `restaurantId`). Bypasses the full order/inventory/payment saga — review's
 * eligibility consumer only cares about this one topic's contract, the same
 * shortcut notification-e2e takes for its own `order.events` consumer.
 */
export async function produceOrderConfirmed(event: OrderConfirmedEvent): Promise<void> {
  const client: KafkaClient = createKafkaClient({
    clientId: `review-e2e-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const producer = client.producer({ kafkaJS: { idempotent: false, acks: -1 } });
  await producer.connect();
  try {
    await producer.send({
      topic: ORDER_EVENTS_TOPIC,
      messages: [
        {
          key: event.orderId,
          value: JSON.stringify({
            orderId: event.orderId,
            userId: event.userId,
            status: 'CONFIRMED',
            totalCents: 4200,
            restaurantId: event.restaurantId,
          }),
          headers: encodeHeaders({
            eventId: randomUUID(),
            eventType: ORDER_CONFIRMED,
            aggregateId: event.orderId,
            tenantId: event.tenantId,
            correlationId: randomUUID(),
            occurredAt: new Date().toISOString(),
          }),
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
}
