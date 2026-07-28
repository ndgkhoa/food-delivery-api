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
  /**
   * Publishes the raw message to its dead-letter topic, retrying transient
   * broker faults. Resolves `true` once the DLQ write is durable, `false` if it
   * could not be written — it must NOT throw.
   */
  deadLetter: (
    raw: RawInboundMessage,
    reason: DropReason,
    failureReason: string,
  ) => Promise<boolean>;
  /** Advances the group past this message. Called once the message is safely handled or dead-lettered. */
  commit: () => Promise<void>;
  maxAttempts: number;
  retryDelayMs: number;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/**
 * Processes one inbound message end to end. An undecodable message
 * (structurally unrecoverable) and a handler that exhausts its retry budget are
 * both routed to the dead-letter topic, and the offset advances ONLY once that
 * DLQ write is confirmed — so the message is never silently lost. If the DLQ
 * write itself fails, the offset is left UNCOMMITTED so the message redelivers
 * (handlers are idempotent) instead of vanishing: the DLQ shares the broker with
 * the source topic, so a DLQ outage means the broker is down and everything is
 * stalled anyway. The drop counter counts confirmed DLQ writes, not intents.
 * Extracted from the subscriber so both drop paths are unit-testable without a
 * broker.
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

/**
 * Dead-letter the message, then advance the offset only if the DLQ write
 * succeeded. On DLQ failure the offset stays put so the message redelivers
 * rather than being lost, and the drop is not counted (it counts durable DLQ
 * writes, not attempts).
 */
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
