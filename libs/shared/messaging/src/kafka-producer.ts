import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { KAFKA_CLIENT, type KafkaClient } from './kafka-client';

export interface OutboundKafkaMessage {
  topic: string;
  /** Partition key — same key always lands on the same partition, giving per-aggregate ordering. */
  key: string;
  headers: Record<string, string>;
  /** JSON-serialized on the wire; pass any JSON-serializable value. */
  value: unknown;
}

/** Port a use case/adapter publishes through — never the confluent client directly. */
export interface MessageProducer {
  publish(message: OutboundKafkaMessage): Promise<void>;
  publishBatch(messages: OutboundKafkaMessage[]): Promise<void>;
}

export const KAFKA_PRODUCER = Symbol('KafkaProducer');

type WireMessage = { key: Buffer; value: Buffer; headers: Record<string, Buffer> };

function toWireHeaders(headers: Record<string, string>): Record<string, Buffer> {
  const wire: Record<string, Buffer> = {};
  for (const [name, value] of Object.entries(headers)) {
    wire[name] = Buffer.from(value, 'utf8');
  }
  return wire;
}

function toWireMessage(message: OutboundKafkaMessage): WireMessage {
  return {
    key: Buffer.from(message.key, 'utf8'),
    value: Buffer.from(JSON.stringify(message.value), 'utf8'),
    headers: toWireHeaders(message.headers),
  };
}

/**
 * Idempotent producer adapter (`enable.idempotence` + `acks=all`, expressed
 * via the client's kafkaJS-compatible config) over the confluent client. Owns
 * its connection lifecycle: connects on module init, flushes in-flight sends
 * and disconnects on shutdown.
 */
@Injectable()
export class ConfluentMessageProducer implements MessageProducer, OnModuleInit, OnModuleDestroy {
  private readonly producer: KafkaJS.Producer;

  constructor(@Inject(KAFKA_CLIENT) client: KafkaClient) {
    // idempotent:true + acks:-1 ("all") is the kafkaJS-config equivalent of
    // the raw `enable.idempotence=true` / `acks=all` librdkafka options.
    this.producer = client.producer({ kafkaJS: { idempotent: true, acks: -1 } });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.flush();
    await this.producer.disconnect();
  }

  async publish(message: OutboundKafkaMessage): Promise<void> {
    await this.producer.send({ topic: message.topic, messages: [toWireMessage(message)] });
  }

  async publishBatch(messages: OutboundKafkaMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    const byTopic = new Map<string, WireMessage[]>();
    for (const message of messages) {
      const bucket = byTopic.get(message.topic) ?? [];
      bucket.push(toWireMessage(message));
      byTopic.set(message.topic, bucket);
    }
    await this.producer.sendBatch({
      topicMessages: [...byTopic.entries()].map(([topic, wireMessages]) => ({
        topic,
        messages: wireMessages,
      })),
    });
  }
}
