import type { TenantContextPort } from '@food-delivery-api/shared-tenancy';
import type { Logger } from '@nestjs/common';
import type { RawInboundMessage } from './dead-letter';
import { decodeHeaders, type EventEnvelopeHeaders, type RawKafkaHeaders } from './event-envelope';
import type { DropReason, MessageDropCounter } from './message-drop-counter';

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

export type HandlerOutcome = { ok: true } | { ok: false; reason: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function runHandlerWithRetry<TPayload>(
  handler: KafkaMessageHandler<TPayload>,
  message: DecodedKafkaMessage<TPayload>,
  tenantContext: TenantContextPort,
  options: { maxAttempts: number; retryDelayMs: number; logger: Pick<Logger, 'warn' | 'error'> },
): Promise<HandlerOutcome> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await tenantContext.run(
        { tenantId: message.envelope.tenantId, actor: 'system', roles: [] },
        () => handler(message),
      );
      return { ok: true };
    } catch (error) {
      const reason = reasonOf(error);
      if (attempt >= options.maxAttempts) {
        options.logger.error(
          `Handler failed after ${options.maxAttempts} attempts for event "${message.envelope.eventId}" ` +
            `(${message.topic}[${message.partition}]@${message.offset}); dead-lettering: ${reason}`,
        );
        return { ok: false, reason };
      }
      options.logger.warn(
        `Handler attempt ${attempt}/${options.maxAttempts} failed for event "${message.envelope.eventId}": ${reason}`,
      );
      await sleep(options.retryDelayMs * attempt);
    }
  }
  return { ok: false, reason: 'retry budget exhausted' };
}

export function decodeMessage(
  topic: string,
  partition: number,
  message: { offset: string; value: Buffer | null; headers?: RawKafkaHeaders },
): DecodedKafkaMessage {
  const envelope = decodeHeaders(message.headers);
  const payload = message.value ? JSON.parse(message.value.toString('utf8')) : undefined;
  return { envelope, payload, topic, partition, offset: message.offset };
}

export interface ConsumeMessageDeps {
  handler: KafkaMessageHandler;
  tenantContext: TenantContextPort;
  dropCounter: MessageDropCounter;
  deadLetter: (
    raw: RawInboundMessage,
    reason: DropReason,
    failureReason: string,
  ) => Promise<boolean>;
  commit: () => Promise<void>;
  maxAttempts: number;
  retryDelayMs: number;
  logger: Pick<Logger, 'warn' | 'error'>;
}

export async function consumeOneMessage(
  raw: RawInboundMessage,
  deps: ConsumeMessageDeps,
): Promise<void> {
  const { topic, partition, message } = raw;

  let decoded: DecodedKafkaMessage;
  try {
    decoded = decodeMessage(topic, partition, message);
  } catch (error) {
    await deadLetterThenCommit(raw, 'undecodable', reasonOf(error), deps);
    return;
  }

  const outcome = await runHandlerWithRetry(deps.handler, decoded, deps.tenantContext, {
    maxAttempts: deps.maxAttempts,
    retryDelayMs: deps.retryDelayMs,
    logger: deps.logger,
  });
  if (outcome.ok) {
    await deps.commit();
    return;
  }
  await deadLetterThenCommit(raw, 'handler-exhausted', outcome.reason, deps);
}

async function deadLetterThenCommit(
  raw: RawInboundMessage,
  reason: DropReason,
  failureReason: string,
  deps: ConsumeMessageDeps,
): Promise<void> {
  const { topic, partition, message } = raw;
  deps.logger.error(
    `Dead-lettering ${reason} message ${topic}[${partition}]@${message.offset}: ${failureReason}`,
  );
  const published = await deps.deadLetter(raw, reason, failureReason);
  if (!published) {
    deps.logger.error(
      `Could not dead-letter ${topic}[${partition}]@${message.offset}; leaving it uncommitted for redelivery`,
    );
    return;
  }
  deps.dropCounter.record(topic, reason);
  await deps.commit();
}
