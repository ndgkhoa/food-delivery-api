import type { KafkaJS } from '@confluentinc/kafka-javascript';
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
  /** Attempts before dead-lettering + advancing past a poison message. @default 3 */
  maxAttempts?: number;
  /** Base delay between retries in ms, multiplied by the attempt number. @default 200 */
  retryDelayMs?: number;
  fromBeginning?: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 200;
/** DLQ-publish retries before giving up and leaving the message uncommitted for redelivery. */
const DLQ_PUBLISH_ATTEMPTS = 3;
const DLQ_PUBLISH_RETRY_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Manual-commit subscribe helper: for each message, decodes the envelope
 * headers, runs the handler (with retry) inside the tenant scope the envelope
 * carries — never trusting the payload alone for tenant identity — then commits
 * the offset. An undecodable message and a handler that exhausts its retries are
 * BOTH routed to `<topic>.dlq` (original bytes + failure reason preserved) and
 * counted, then committed past: no saga command/reply is silently lost. The DLQ
 * publish retries transient faults; if it still can't be written the offset is
 * left UNCOMMITTED so the message redelivers (handlers are idempotent) rather
 * than vanishing — the DLQ shares the broker with the source topic, so a DLQ
 * outage means the broker is down and the partition is stalled regardless.
 */
@Injectable()
export class KafkaConsumerSubscriber implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerSubscriber.name);
  private readonly dropCounter = new MessageDropCounter();
  // A promise (not the resolved producer) so two consumers sharing this
  // singleton subscriber can't each connect a producer in a lazy-init race.
  private dlqProducerPromise: Promise<ConfluentMessageProducer> | null = null;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly client: KafkaClient,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  /** In-process count of messages dropped to a DLQ, tagged by topic + reason. */
  getDropCounts(): Record<string, number> {
    return this.dropCounter.snapshot();
  }

  /**
   * Idempotently create the topics this consumer subscribes to AND their
   * dead-letter topics (3 partitions, RF=1 — the repo's single-broker dev
   * shape) so neither the subscribe nor a DLQ publish ever stalls on a
   * not-yet-created topic. A no-op for existing topics.
   */
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

  /** Lazily connects one shared idempotent producer used only for DLQ publishes. */
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

  /**
   * Publishes the message to `<topic>.dlq`, retrying transient broker faults.
   * Resolves `true` once the DLQ write is durable, `false` if it could not be
   * written after `DLQ_PUBLISH_ATTEMPTS` — never throws (throwing out of
   * eachMessage would re-seek and stall the partition). On `false` the caller
   * leaves the offset uncommitted so the message redelivers instead of vanishing.
   */
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
        // Manual commit: we only advance the offset after the handler ran, was
        // dead-lettered, or was skipped — never on a fixed timer.
        autoCommit: false,
        fromBeginning: options.fromBeginning ?? false,
      },
    });
    await consumer.connect();
    // Ensure the subscribed topics AND their DLQ topics exist BEFORE subscribing.
    // librdkafka only refreshes topic metadata every ~5 min by default, so a
    // consumer/producer targeting a not-yet-created topic would sit idle for
    // minutes. createTopics is idempotent, so this is safe on every boot.
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
        await consumeOneMessage(raw, {
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
        });
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
