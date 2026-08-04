import { randomUUID } from 'node:crypto';
import { createKafkaClient, encodeHeaders } from '@food-delivery-api/shared-messaging';
import { KAFKA_BROKERS, ORDER_EVENTS_TOPIC } from './delivery-e2e-config';

function toWireHeaders(headers: Record<string, string>): Record<string, Buffer> {
  const wire: Record<string, Buffer> = {};
  for (const [name, value] of Object.entries(headers)) {
    wire[name] = Buffer.from(value, 'utf8');
  }
  return wire;
}

export async function produceOrderConfirmed(params: {
  orderId: string;
  tenantId: string;
  userId: string;
  totalCents: number;
}): Promise<void> {
  const client = createKafkaClient({
    clientId: `delivery-e2e-producer-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const producer = client.producer({ kafkaJS: { idempotent: false, acks: -1 } });
  await producer.connect();
  try {
    const headers = encodeHeaders({
      eventId: randomUUID(),
      eventType: 'OrderConfirmed',
      aggregateId: params.orderId,
      tenantId: params.tenantId,
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
    });
    await producer.send({
      topic: ORDER_EVENTS_TOPIC,
      messages: [
        {
          key: Buffer.from(params.orderId, 'utf8'),
          value: Buffer.from(
            JSON.stringify({
              orderId: params.orderId,
              userId: params.userId,
              status: 'CONFIRMED',
              totalCents: params.totalCents,
            }),
            'utf8',
          ),
          headers: toWireHeaders(headers),
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
}
