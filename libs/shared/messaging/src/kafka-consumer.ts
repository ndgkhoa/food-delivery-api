import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeHeaders, type EventEnvelopeHeaders, type RawKafkaHeaders } from './event-envelope';
import { KAFKA_CLIENT, type KafkaClient } from './kafka-client';

export interface DecodedKafkaMessage<TPayload = unknown> {
  envelope: EventEnvelopeHeaders;
  payload: TPayload;
  topic: string;
  partition: number;
  offset: string;
}

export type KafkaMessageHandler<TPayload = unknown> = (
  message: DecodedKafkaMessage<TPayload>,
) => Promise<void>;

export interface KafkaSubscribeOptions<TPayload = unknown> {
  groupId: string;
  topics: string[];
  handler: KafkaMessageHandler<TPayload>;
  /** Attempts before logging + skipping (advancing past) a poison message. @default 3 */
  maxAttempts?: number;
  /** Base delay between retries in ms, multiplied by the attempt number. @default 200 */
  retryDelayMs?: number;
  fromBeginning?: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `handler` for one decoded message inside the tenant scope carried by
 * its envelope, retrying on failure up to `maxAttempts` times. After the
 * budget is exhausted the failure is logged and swallowed — full
 * dead-lettering is out of scope for this slice (P5); this shared substrate
 * must not stall a partition forever on one poison message. Exported as a
 * pure(ish) function (only side effects are the handler call, sleep, and the
 * logger) so retry/skip semantics are unit-testable without a real broker.
 */
export async function runHandlerWithRetry<TPayload>(
  handler: KafkaMessageHandler<TPayload>,
  message: DecodedKafkaMessage<TPayload>,
  tenantContext: TenantContextPort,
  options: { maxAttempts: number; retryDelayMs: number; logger: Pick<Logger, 'warn' | 'error'> },
): Promise<void> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await tenantContext.run(
        { tenantId: message.envelope.tenantId, actor: 'system', roles: [] },
        () => handler(message),
      );
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt >= options.maxAttempts) {
        options.logger.error(
          `Handler failed after ${options.maxAttempts} attempts for event "${message.envelope.eventId}" ` +
            `(${message.topic}[${message.partition}]@${message.offset}); skipping: ${reason}`,
        );
        return;
      }
      options.logger.warn(
        `Handler attempt ${attempt}/${options.maxAttempts} failed for event "${message.envelope.eventId}": ${reason}`,
      );
      await sleep(options.retryDelayMs * attempt);
    }
  }
}

function decodeMessage(
  topic: string,
  partition: number,
  message: KafkaJS.KafkaMessage,
): DecodedKafkaMessage {
  const envelope = decodeHeaders(message.headers as RawKafkaHeaders | undefined);
  const payload = message.value ? JSON.parse(message.value.toString('utf8')) : undefined;
  return { envelope, payload, topic, partition, offset: message.offset };
}

/**
 * Manual-commit subscribe helper: for each message, decodes the envelope
 * headers, runs the handler (with retry) inside the tenant scope the
 * envelope carries — never trusting the payload alone for tenant identity —
 * then commits the offset. Commits happen whether the handler ultimately
 * succeeded or was skipped after exhausting retries, so the group always
 * advances.
 */
@Injectable()
export class KafkaConsumerSubscriber {
  private readonly logger = new Logger(KafkaConsumerSubscriber.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly client: KafkaClient,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async subscribe<TPayload = unknown>(
    options: KafkaSubscribeOptions<TPayload>,
  ): Promise<KafkaJS.Consumer> {
    const consumer = this.client.consumer({
      kafkaJS: {
        groupId: options.groupId,
        // Manual commit: we only advance the offset after the handler ran
        // (or was skipped), never on a fixed timer.
        autoCommit: false,
        fromBeginning: options.fromBeginning ?? false,
      },
    });
    await consumer.connect();
    await consumer.subscribe({ topics: options.topics });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const commitPast = (): Promise<void> =>
          consumer.commitOffsets([
            { topic, partition, offset: String(BigInt(message.offset) + 1n) },
          ]);

        let decoded: DecodedKafkaMessage;
        try {
          decoded = decodeMessage(topic, partition, message);
        } catch (error) {
          // A message we can't decode (missing envelope headers — e.g. a
          // non-enveloped message on the topic — or a corrupt payload) is NOT
          // retryable: retrying can never add the headers. Log + commit past it
          // so one poison message can never stall the partition forever — the
          // failure mode if this throw escaped eachMessage (the vendor would
          // seek back and redeliver the same offset indefinitely).
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Skipping undecodable message ${topic}[${partition}]@${message.offset}: ${reason}`,
          );
          await commitPast();
          return;
        }

        await runHandlerWithRetry(
          options.handler as KafkaMessageHandler,
          decoded,
          this.tenantContext,
          {
            maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
            retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
            logger: this.logger,
          },
        );
        await commitPast();
      },
    });
    return consumer;
  }
}
