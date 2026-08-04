import { randomUUID } from 'node:crypto';
import { createKafkaClient, deadLetterTopic } from '@food-delivery-api/shared-messaging';
import { KAFKA_BROKERS } from './saga-e2e-support';

export interface CapturedRecord {
  key: Buffer | null;
  value: Buffer | null;
  headers: Record<string, Buffer>;
}

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

interface DlqRecord {
  sourceTopic: string;
  sourceOffset: string;
  reason: string;
  failureReason: string;
}

export async function readDlq(topic: string, windowMs = 5_000): Promise<DlqRecord[]> {
  const records = await collectRecords(deadLetterTopic(topic), () => true, windowMs);
  return records.map((record) => JSON.parse((record.value ?? Buffer.from('{}')).toString('utf8')));
}
