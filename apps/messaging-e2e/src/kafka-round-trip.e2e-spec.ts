import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  ConfluentMessageProducer,
  createKafkaClient,
  type DecodedKafkaMessage,
  encodeHeaders,
  type KafkaClient,
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
} from '@food-delivery-api/shared-messaging';
import { AlsTenantContextAdapter } from '@food-delivery-api/shared-tenancy';
import { KafkaContainer, type StartedKafkaContainer } from '@testcontainers/kafka';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.9.1';
const KAFKA_EXTERNAL_PORT = 9093;

function bootstrapServers(container: StartedKafkaContainer): string[] {
  return [`${container.getHost()}:${container.getMappedPort(KAFKA_EXTERNAL_PORT)}`];
}

async function waitUntil(
  check: () => boolean,
  timeoutMs = 30_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Kafka messaging round-trip (e2e)', () => {
  let container: StartedKafkaContainer;
  let client: KafkaClient;
  let producer: ConfluentMessageProducer;
  let admin: KafkaTopicAdmin;

  beforeAll(async () => {
    container = await new KafkaContainer(KAFKA_IMAGE).start();
    client = createKafkaClient({ clientId: 'messaging-e2e', brokers: bootstrapServers(container) });
    producer = new ConfluentMessageProducer(client);
    await producer.onModuleInit();
    admin = new KafkaTopicAdmin(client);
  }, 180_000);

  afterAll(async () => {
    await producer?.onModuleDestroy();
    await container?.stop();
  });

  it('round-trips keyed messages with intact headers + value and same-key ordering', async () => {
    const topic = `messaging-e2e.${randomUUID()}`;
    await admin.ensureTopics([{ topic, partitions: 3, replicationFactor: 1 }]);

    const aggregateId = randomUUID();
    const tenantId = randomUUID();
    const firstEnvelope = {
      eventId: randomUUID(),
      eventType: 'e2e.test-event',
      aggregateId,
      tenantId,
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    const secondEnvelope = { ...firstEnvelope, eventId: randomUUID() };

    await producer.publish({
      topic,
      key: aggregateId,
      headers: encodeHeaders(firstEnvelope),
      value: { orderId: aggregateId, sequence: 1 },
    });
    await producer.publish({
      topic,
      key: aggregateId,
      headers: encodeHeaders(secondEnvelope),
      value: { orderId: aggregateId, sequence: 2 },
    });

    const received: DecodedKafkaMessage[] = [];
    const tenantContext = new AlsTenantContextAdapter();
    const subscriber = new KafkaConsumerSubscriber(client, tenantContext);
    const consumer = await subscriber.subscribe({
      groupId: `messaging-e2e-${randomUUID()}`,
      topics: [topic],
      fromBeginning: true,
      handler: async (message) => {
        received.push(message);
      },
    });

    try {
      await waitUntil(() => received.length >= 2);
    } finally {
      await consumer.disconnect();
    }

    expect(received).toHaveLength(2);
    expect(received[0].envelope.eventId).toBe(firstEnvelope.eventId);
    expect(received[0].envelope.tenantId).toBe(tenantId);
    expect(received[0].payload).toEqual({ orderId: aggregateId, sequence: 1 });
    expect(received[1].envelope.eventId).toBe(secondEnvelope.eventId);
    expect(received[1].payload).toEqual({ orderId: aggregateId, sequence: 2 });

    expect(received[0].partition).toBe(received[1].partition);
    expect(Number(received[1].offset)).toBeGreaterThan(Number(received[0].offset));
  });

  it('skips an undecodable (header-less) message without stalling the partition', async () => {
    const topic = `messaging-e2e-poison.${randomUUID()}`;
    await admin.ensureTopics([{ topic, partitions: 1, replicationFactor: 1 }]);
    const key = randomUUID();

    await producer.publish({ topic, key, headers: {}, value: { poison: true } });

    const good = {
      eventId: randomUUID(),
      eventType: 'e2e.good-after-poison',
      aggregateId: key,
      tenantId: randomUUID(),
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    await producer.publish({ topic, key, headers: encodeHeaders(good), value: { ok: true } });

    const received: DecodedKafkaMessage[] = [];
    const subscriber = new KafkaConsumerSubscriber(client, new AlsTenantContextAdapter());
    const consumer = await subscriber.subscribe({
      groupId: `messaging-e2e-poison-${randomUUID()}`,
      topics: [topic],
      fromBeginning: true,
      handler: async (message) => {
        received.push(message);
      },
    });

    try {
      await waitUntil(() => received.length >= 1);
    } finally {
      await consumer.disconnect();
    }

    expect(received).toHaveLength(1);
    expect(received[0].envelope.eventId).toBe(good.eventId);
  });
});
