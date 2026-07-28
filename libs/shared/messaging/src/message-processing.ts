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

/** Outcome of running a handler with retry — `ok` when it succeeded, else the last failure reason. */
export type HandlerOutcome = { ok: true } | { ok: false; reason: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs `handler` for one decoded message inside the tenant scope carried by its
 * envelope, retrying on failure up to `maxAttempts` times. Returns
 * `{ ok: false }` (never throws) once the budget is exhausted so the caller can
 * dead-letter the message: a handler that keeps throwing past its retry budget
 * must NOT be silently skipped (that strands a saga + leaks a stock hold), but
 * it also must never stall the partition. Pure (only side effects are the
 * handler call, sleep, and the logger) so retry semantics are unit-testable
 * without a real broker.
 */
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
  // Unreachable (loop returns), but keeps the function total for the type checker.
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
  /** Publishes the raw message to its dead-letter topic. Best-effort — must not throw. */
  deadLetter: (raw: RawInboundMessage, reason: DropReason, failureReason: string) => Promise<void>;
  /** Advances the group past this message. Called on EVERY path so a partition never stalls. */
  commit: () => Promise<void>;
  maxAttempts: number;
  retryDelayMs: number;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/**
 * Processes one inbound message end to end and ALWAYS advances the partition:
 * an undecodable message (structurally unrecoverable) and a handler that
 * exhausts its retry budget are both routed to the dead-letter topic + counted,
 * then committed past — the message is preserved for replay, never silently
 * lost, and the partition keeps moving. Extracted from the subscriber so both
 * drop paths are unit-testable without a broker.
 */
export async function consumeOneMessage(
  raw: RawInboundMessage,
  deps: ConsumeMessageDeps,
): Promise<void> {
  const { topic, partition, message } = raw;

  let decoded: DecodedKafkaMessage;
  try {
    decoded = decodeMessage(topic, partition, message);
  } catch (error) {
    const failureReason = reasonOf(error);
    deps.logger.error(
      `Dead-lettering undecodable message ${topic}[${partition}]@${message.offset}: ${failureReason}`,
    );
    deps.dropCounter.record(topic, 'undecodable');
    await deps.deadLetter(raw, 'undecodable', failureReason);
    await deps.commit();
    return;
  }

  const outcome = await runHandlerWithRetry(deps.handler, decoded, deps.tenantContext, {
    maxAttempts: deps.maxAttempts,
    retryDelayMs: deps.retryDelayMs,
    logger: deps.logger,
  });
  if (!outcome.ok) {
    deps.dropCounter.record(topic, 'handler-exhausted');
    await deps.deadLetter(raw, 'handler-exhausted', outcome.reason);
  }
  await deps.commit();
}
