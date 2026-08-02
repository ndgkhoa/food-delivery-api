import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { injectTraceContext } from '@food-delivery-api/shared-observability';
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
  // ADDITIVE to the envelope's `x-*` headers, never overwriting one already
  // present (a future outbox row that captures its own trace context at write
  // time would win over whatever this publish-time injection produces).
  // `injectTraceContext` always attaches a valid traceparent (it starts its
  // own span if nothing is already active — see kafka-trace-propagation.ts),
  // so the producer -> consumer boundary never goes untraced even for an
  // outbox-relay publish tick with no request in flight.
  if (!message.headers.traceparent) {
    injectTraceContext(message.headers);
  }
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
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /** Opens the underlying producer connection. Exposed so a manually-constructed
   * instance (e.g. the subscriber's lazy DLQ producer) can connect without Nest. */
  async connect(): Promise<void> {
    await this.producer.connect();
  }

  /** Flushes in-flight sends then closes the connection. */
  async disconnect(): Promise<void> {
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
