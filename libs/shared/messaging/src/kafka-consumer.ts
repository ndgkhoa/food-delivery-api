import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { recordDlqMessage, runWithExtractedContext } from '@food-delivery-api/shared-observability';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { buildDeadLetterMessage, deadLetterTopic, type RawInboundMessage } from './dead-letter';
import type { RawKafkaHeaders } from './event-envelope';
import { DEFAULT_TOPIC_PARTITIONS, DEFAULT_TOPIC_REPLICATION_FACTOR } from './kafka-admin';
import { KAFKA_CLIENT, type KafkaClient } from './kafka-client';
import { ConfluentMessageProducer } from './kafka-producer';
import { type DropReason, MessageDropCounter } from './message-drop-counter';
import { consumeOneMessage, type KafkaMessageHandler } from './message-processing';

export type {
  DecodedKafkaMessage,
  HandlerOutcome,
  KafkaMessageHandler,
} from './message-processing';
export { consumeOneMessage, decodeMessage, runHandlerWithRetry } from './message-processing';

export interface KafkaSubscribeOptions<TPayload = unknown> {
  groupId: string;
  topics: string[];
  handler: KafkaMessageHandler<TPayload>;
  maxAttempts?: number;
  retryDelayMs?: number;
  fromBeginning?: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 200;
const DLQ_PUBLISH_ATTEMPTS = 3;
const DLQ_PUBLISH_RETRY_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class KafkaConsumerSubscriber implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerSubscriber.name);
  private readonly dropCounter = new MessageDropCounter();
  private dlqProducerPromise: Promise<ConfluentMessageProducer> | null = null;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly client: KafkaClient,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  getDropCounts(): Record<string, number> {
    return this.dropCounter.snapshot();
  }

  private async ensureTopicsExist(topics: string[]): Promise<void> {
    if (topics.length === 0) {
      return;
    }
    const admin = this.client.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: topics.map((topic) => ({
          topic,
          numPartitions: DEFAULT_TOPIC_PARTITIONS,
          replicationFactor: DEFAULT_TOPIC_REPLICATION_FACTOR,
        })),
      });
    } finally {
      await admin.disconnect();
    }
  }

  private deadLetterProducer(): Promise<ConfluentMessageProducer> {
    if (!this.dlqProducerPromise) {
      this.dlqProducerPromise = (async () => {
        const producer = new ConfluentMessageProducer(this.client);
        await producer.connect();
        return producer;
      })();
    }
    return this.dlqProducerPromise;
  }

  private async publishDeadLetter(
    raw: RawInboundMessage,
    reason: DropReason,
    failureReason: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= DLQ_PUBLISH_ATTEMPTS; attempt += 1) {
      try {
        const producer = await this.deadLetterProducer();
        await producer.publish(buildDeadLetterMessage(raw, reason, failureReason));
        this.logger.warn(
          `Dead-lettered ${raw.topic}[${raw.partition}]@${raw.message.offset} to ` +
            `${deadLetterTopic(raw.topic)} (${reason})`,
        );
        recordDlqMessage(raw.topic);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt >= DLQ_PUBLISH_ATTEMPTS) {
          this.logger.error(
            `Failed to dead-letter ${raw.topic}[${raw.partition}]@${raw.message.offset} after ` +
              `${DLQ_PUBLISH_ATTEMPTS} attempts: ${detail}`,
          );
          return false;
        }
        await sleep(DLQ_PUBLISH_RETRY_DELAY_MS * attempt);
      }
    }
    return false;
  }

  async subscribe<TPayload = unknown>(
    options: KafkaSubscribeOptions<TPayload>,
  ): Promise<KafkaJS.Consumer> {
    const consumer = this.client.consumer({
      kafkaJS: {
        groupId: options.groupId,
        autoCommit: false,
        fromBeginning: options.fromBeginning ?? false,
      },
    });
    await consumer.connect();
    await this.ensureTopicsExist([...options.topics, ...options.topics.map(deadLetterTopic)]);
    await consumer.subscribe({ topics: options.topics });
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const raw: RawInboundMessage = {
          topic,
          partition,
          message: {
            offset: message.offset,
            key: message.key ?? null,
            value: message.value ?? null,
            headers: message.headers as RawKafkaHeaders | undefined,
          },
        };
        await runWithExtractedContext(raw.message.headers, `${topic} process`, () =>
          consumeOneMessage(raw, {
            handler: options.handler as KafkaMessageHandler,
            tenantContext: this.tenantContext,
            dropCounter: this.dropCounter,
            deadLetter: (r, reason, failureReason) =>
              this.publishDeadLetter(r, reason, failureReason),
            commit: () =>
              consumer.commitOffsets([
                { topic, partition, offset: String(BigInt(message.offset) + 1n) },
              ]),
            maxAttempts,
            retryDelayMs,
            logger: this.logger,
          }),
        );
      },
    });
    return consumer;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dlqProducerPromise) {
      const producer = await this.dlqProducerPromise.catch(() => null);
      await producer?.disconnect();
    }
  }
}
