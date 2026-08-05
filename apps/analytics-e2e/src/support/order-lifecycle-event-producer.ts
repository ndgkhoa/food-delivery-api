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
  totalCents: number;
  restaurantId?: string;
  eventType?: string;
  eventId?: string;
  correlationId?: string;
}

export async function produceOrderLifecycleEvent(event: OrderLifecycleEvent): Promise<string> {
  const eventId = event.eventId ?? randomUUID();
  const eventType = event.eventType ?? ORDER_CONFIRMED;
  const client: KafkaClient = createKafkaClient({
    clientId: `analytics-e2e-${randomUUID()}`,
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
            totalCents: event.totalCents,
            ...(event.restaurantId ? { restaurantId: event.restaurantId } : {}),
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
