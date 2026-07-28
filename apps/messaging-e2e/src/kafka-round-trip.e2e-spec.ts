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

// The @testcontainers/kafka module auto-configures advertised listeners for the
// Confluent cp-kafka image family (its supported convention); the raw apache/kafka
// image isn't wired up the same way, so the broker never advertises the mapped
// host port. This e2e proves the CLIENT round-trip, so a supported broker image is
// what matters — local dev/compose still runs apache/kafka:4.3.1.
const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.9.1';
// The testcontainers Kafka module always exposes the plaintext client listener on 9093
// (a second, container-internal-only listener handles inter-broker traffic).
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

/**
 * Proves `libs/shared/messaging`'s producer/consumer/header-codec/admin
 * wiring end-to-end against a real, throwaway Kafka broker: bootstrap a
 * topic, produce two keyed messages with an event envelope, consume them in
 * a group with manual offset commit, and assert the headers/value/ordering
 * survived the round trip — including that same-key messages land on the
 * same partition in produce order.
 *
 *   pnpm nx e2e messaging-e2e
 */
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

    // Same partition key → same partition → produce order is preserved.
    expect(received[0].partition).toBe(received[1].partition);
    expect(Number(received[1].offset)).toBeGreaterThan(Number(received[0].offset));
  });

  it('skips an undecodable (header-less) message without stalling the partition', async () => {
    const topic = `messaging-e2e-poison.${randomUUID()}`;
    await admin.ensureTopics([{ topic, partitions: 1, replicationFactor: 1 }]);
    const key = randomUUID();

    // A message with NO envelope headers (e.g. a non-enveloped producer / a raw
    // CDC message): decodeHeaders will throw. It sits BEFORE a valid one on the
    // same partition — if decode failure stalled the partition, the valid
    // message would never be delivered and this test would time out.
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

    // The poison message was skipped; only the valid one reached the handler.
    expect(received).toHaveLength(1);
    expect(received[0].envelope.eventId).toBe(good.eventId);
  });
});
