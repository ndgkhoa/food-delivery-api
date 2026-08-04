import { randomUUID } from 'node:crypto';
import {
  createKafkaClient,
  decodeHeaders,
  encodeHeaders,
  type KafkaClient,
} from '@food-delivery-api/shared-messaging';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const PAYMENT_COMMANDS_TOPIC = 'payment.commands';
const PAYMENT_REPLIES_TOPIC = 'payment.replies';

const CHARGE_PAYMENT = 'ChargePayment';

export interface ChargeCommand {
  orderId: string;
  totalCents: number;
  tenantId: string;
  eventId?: string;
  correlationId?: string;
}

export interface PaymentReply {
  eventType: string;
  orderId: string;
  reason?: string;
}

export async function produceChargeCommand(command: ChargeCommand): Promise<string> {
  const eventId = command.eventId ?? randomUUID();
  const client = createKafkaClient({
    clientId: `payment-e2e-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const producer = client.producer({ kafkaJS: { idempotent: false, acks: -1 } });
  await producer.connect();
  try {
    await producer.send({
      topic: PAYMENT_COMMANDS_TOPIC,
      messages: [
        {
          key: command.orderId,
          value: JSON.stringify({ orderId: command.orderId, totalCents: command.totalCents }),
          headers: encodeHeaders({
            eventId,
            eventType: CHARGE_PAYMENT,
            aggregateId: command.orderId,
            tenantId: command.tenantId,
            correlationId: command.correlationId ?? randomUUID(),
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

export async function collectRepliesForOrder(
  orderId: string,
  windowMs = 20_000,
): Promise<PaymentReply[]> {
  const client: KafkaClient = createKafkaClient({
    clientId: `payment-e2e-replies-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const consumer = client.consumer({
    kafkaJS: { groupId: `payment-e2e-replies-${randomUUID()}`, fromBeginning: true },
  });
  const replies: PaymentReply[] = [];
  await consumer.connect();
  await consumer.subscribe({ topics: [PAYMENT_REPLIES_TOPIC] });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const headers = decodeHeaders(message.headers as Record<string, Buffer> | undefined);
      if (headers.aggregateId !== orderId) {
        return;
      }
      const payload = message.value ? JSON.parse(message.value.toString('utf8')) : {};
      replies.push({ eventType: headers.eventType, orderId, reason: payload.reason });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  await consumer.disconnect();
  return replies;
}
