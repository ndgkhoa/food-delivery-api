import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { injectTraceContext } from '@food-delivery-api/shared-observability';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { KAFKA_CLIENT, type KafkaClient } from './kafka-client';

export interface OutboundKafkaMessage {
  topic: string;
  key: string;
  headers: Record<string, string>;
  value: unknown;
}

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
  if (!message.headers.traceparent) {
    injectTraceContext(message.headers);
  }
  return {
    key: Buffer.from(message.key, 'utf8'),
    value: Buffer.from(JSON.stringify(message.value), 'utf8'),
    headers: toWireHeaders(message.headers),
  };
}

@Injectable()
export class ConfluentMessageProducer implements MessageProducer, OnModuleInit, OnModuleDestroy {
  private readonly producer: KafkaJS.Producer;

  constructor(@Inject(KAFKA_CLIENT) client: KafkaClient) {
    this.producer = client.producer({ kafkaJS: { idempotent: true, acks: -1 } });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

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
