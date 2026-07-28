import { randomUUID } from 'node:crypto';
import { createKafkaClient, deadLetterTopic } from '@food-delivery-api/shared-messaging';
import { KAFKA_BROKERS } from './saga-e2e-support';

/** One raw Kafka record captured off a topic (bytes preserved for exact re-publish). */
export interface CapturedRecord {
  key: Buffer | null;
  value: Buffer | null;
  headers: Record<string, Buffer>;
}

/**
 * Collects raw records off `topic` for a bounded window using a fresh consumer
 * group (from the beginning), returning every record whose decoded JSON value
 * matches `predicate`. Used by the duplicate-injection + DLQ helpers — a raw
 * consumer (not the enveloped subscriber) so DLQ records, which carry x-dlq-*
 * headers rather than the six envelope headers, are readable without decoding.
 */
async function collectRecords(
  topic: string,
  predicate: (value: unknown, record: CapturedRecord) => boolean,
  windowMs: number,
): Promise<CapturedRecord[]> {
  const client = createKafkaClient({
    clientId: `saga-e2e-collect-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const consumer = client.consumer({
    kafkaJS: { groupId: `saga-e2e-collect-${randomUUID()}`, fromBeginning: true },
  });
  const matched: CapturedRecord[] = [];
  await consumer.connect();
  await consumer.subscribe({ topics: [topic] });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const record: CapturedRecord = {
        key: message.key ?? null,
        value: message.value ?? null,
        headers: (message.headers ?? {}) as Record<string, Buffer>,
      };
      const value = record.value ? JSON.parse(record.value.toString('utf8')) : undefined;
      if (predicate(value, record)) {
        matched.push(record);
      }
    },
  });
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  await consumer.disconnect();
  return matched;
}

/**
 * Duplicate injection: reads one record off `topic` matching `predicate`, then
 * re-produces an identical copy (same key + headers + value bytes) to the same
 * topic. Because the record's event id header is unchanged, an idempotent
 * consumer must treat it as a redelivery and apply exactly one effect.
 */
export async function republishRecord(
  topic: string,
  predicate: (value: unknown, record: CapturedRecord) => boolean,
  collectWindowMs = 5_000,
): Promise<void> {
  const [record] = await collectRecords(topic, predicate, collectWindowMs);
  if (!record) {
    throw new Error(`republishRecord: no record on ${topic} matched the predicate`);
  }
  const client = createKafkaClient({
    clientId: `saga-e2e-republish-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const producer = client.producer({ kafkaJS: { idempotent: false, acks: -1 } });
  await producer.connect();
  try {
    await producer.send({
      topic,
      messages: [{ key: record.key, value: record.value, headers: record.headers }],
    });
  } finally {
    await producer.disconnect();
  }
}

/** The decoded DLQ payload the shared subscriber writes (see buildDeadLetterMessage). */
interface DlqRecord {
  sourceTopic: string;
  sourceOffset: string;
  reason: string;
  failureReason: string;
}

/** Reads records off `<topic>.dlq` within a bounded window. */
export async function readDlq(topic: string, windowMs = 5_000): Promise<DlqRecord[]> {
  const records = await collectRecords(deadLetterTopic(topic), () => true, windowMs);
  return records.map((record) => JSON.parse((record.value ?? Buffer.from('{}')).toString('utf8')));
}
