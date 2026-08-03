import { randomUUID } from 'node:crypto';
import {
  createKafkaClient,
  encodeHeaders,
  type KafkaClient,
} from '@food-delivery-api/shared-messaging';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const ORDER_EVENTS_TOPIC = 'order.events';

const ORDER_CONFIRMED = 'OrderConfirmed';
export const ORDER_CANCELLED = 'OrderCancelled';

export interface OrderLifecycleEvent {
  orderId: string;
  userId: string;
  tenantId: string;
  eventType?: string;
  /** Reuse a fixed eventId to simulate a redelivery of the SAME event. */
  eventId?: string;
  correlationId?: string;
}

/**
 * Produces an order lifecycle event to `order.events` with the six envelope
 * headers the notification consumer requires, matching order's real producer
 * payload shape (`orderId`, `userId`, `status`, `totalCents`). Returns the
 * eventId so a test can redeliver the identical event to prove event-id
 * idempotency.
 */
export async function produceOrderLifecycleEvent(event: OrderLifecycleEvent): Promise<string> {
  const eventId = event.eventId ?? randomUUID();
  const eventType = event.eventType ?? ORDER_CONFIRMED;
  const client: KafkaClient = createKafkaClient({
    clientId: `notification-e2e-${randomUUID()}`,
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
            status: eventType === ORDER_CONFIRMED ? 'CONFIRMED' : 'CANCELLED',
            totalCents: 1234,
          }),
          headers: encodeHeaders({
            eventId,
            eventType,
            aggregateId: event.orderId,
            tenantId: event.tenantId,
            correlationId: event.correlationId ?? randomUUID(),
            occurredAt: new Date().toISOString(),
          }),
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
  return eventId;
}
