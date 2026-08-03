import { Logger } from '@nestjs/common';
import { type Context, context, propagation, type Span, SpanKind, trace } from '@opentelemetry/api';
import { recordBullmqJob } from './metrics';

const logger = new Logger('Telemetry');
const TRACER_NAME = 'bullmq-messaging';

/** The job-data key carrying the W3C `traceparent` — BullMQ has no header channel. */
export const BULLMQ_TRACEPARENT_KEY = '__traceparent';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractTraceparent(jobData: unknown): string | undefined {
  if (!jobData || typeof jobData !== 'object') {
    return undefined;
  }
  const value = (jobData as Record<string, unknown>)[BULLMQ_TRACEPARENT_KEY];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Merges a `traceparent` (captured from a short-lived PRODUCER span, exactly
 * like `injectTraceContext` does for Kafka) into outbound BullMQ job data —
 * the only channel a job has, since BullMQ carries no header map. Starting a
 * dedicated `bullmq.enqueue` span rather than relying on whatever happens to
 * be active means an enqueue issued synchronously inside a request parents
 * correctly under that request's trace. Returns `data` UNCHANGED (no key
 * added) when no traceparent was produced (telemetry disabled, no provider
 * registered) — the reserved key must never appear as an empty/undefined
 * value the domain payload types don't expect. Never throws: tracing must
 * never block or fail an enqueue.
 */
export function injectJobTraceContext<T extends object>(data: T): T {
  try {
    const carrier: Record<string, string> = {};
    trace
      .getTracer(TRACER_NAME)
      .startActiveSpan('bullmq.enqueue', { kind: SpanKind.PRODUCER }, (span: Span) => {
        try {
          propagation.inject(context.active(), carrier, {
            set(target, key, value) {
              target[key] = value;
            },
          });
        } finally {
          span.end();
        }
      });
    if (!carrier.traceparent) {
      return data;
    }
    return { ...data, [BULLMQ_TRACEPARENT_KEY]: carrier.traceparent };
  } catch (error) {
    logger.warn(
      `failed to inject trace context into job data, enqueuing without it: ${reasonOf(error)}`,
    );
    return data;
  }
}

/**
 * Removes the reserved `__traceparent` key from job data before the payload is
 * persisted somewhere it outlives the trace — e.g. parked on a dead-letter
 * queue for later inspection/replay. Telemetry-only hygiene: a replay re-injects
 * a fresh context, but a parked payload should read as the clean domain payload,
 * not carry a stale trace id. Returns a shallow copy; never mutates the input.
 */
export function stripJobTraceContext<T extends object>(data: T): T {
  if (!(BULLMQ_TRACEPARENT_KEY in data)) {
    return data;
  }
  const rest = { ...data } as Record<string, unknown>;
  delete rest[BULLMQ_TRACEPARENT_KEY];
  return rest as T;
}

/**
 * Extracts the `traceparent` carried in `jobData[__traceparent]` (if present)
 * and runs `fn` inside a new `bullmq.process` CONSUMER span parented to it, so
 * the job-processing work attaches to the enqueue trace instead of starting a
 * disconnected one — mirrors `runWithExtractedContext` for Kafka. Falls back
 * to running `fn` untraced (still timed + metered) when span setup fails.
 * Records `bullmq_job_duration_ms{queue,outcome}` exactly once per call,
 * whichever path is taken, and ends the span in every case. `fn`'s own
 * rejection propagates untouched — it decides BullMQ's own retry/backoff/DLQ
 * behaviour and must never be reinterpreted as a tracing failure.
 */
export async function runJobWithTrace<T>(
  jobData: unknown,
  queueName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const traceparent = extractTraceparent(jobData);
  let span: Span;
  let activeContext: Context;
  try {
    const extracted = propagation.extract(context.active(), traceparent ? { traceparent } : {});
    // Resolved fresh on every call (never cached at module scope) — see the
    // identical discipline (and its rationale) in `kafka-trace-propagation.ts`.
    span = trace
      .getTracer(TRACER_NAME)
      .startSpan('bullmq.process', { kind: SpanKind.CONSUMER }, extracted);
    activeContext = trace.setSpan(extracted, span);
  } catch (error) {
    // ONLY a tracing-SETUP failure reaches here — the handler has not run yet, so
    // running it once (untraced) is safe. `fn`'s OWN errors must NEVER be caught
    // here: they'd be mislabelled as tracing failures AND re-execute the handler.
    logger.warn(
      `failed to extract trace context for ${queueName}, processing without it: ${reasonOf(error)}`,
    );
    return timeAndRecord(queueName, fn);
  }
  // Setup succeeded: run the handler inside the consumer span exactly once — its
  // errors propagate untouched; the span is ended and the metric recorded
  // whether it resolves or throws (see `timeAndRecord`'s finally).
  return timeAndRecord(queueName, () => context.with(activeContext, fn), span);
}

/** Times `fn`, records its completed/failed outcome, and ends `span` (if any) — once, in a `finally`, regardless of how `fn` settles. */
async function timeAndRecord<T>(queueName: string, fn: () => Promise<T>, span?: Span): Promise<T> {
  const start = process.hrtime.bigint();
  let outcome: 'completed' | 'failed' = 'completed';
  try {
    return await fn();
  } catch (error) {
    outcome = 'failed';
    throw error;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordBullmqJob(queueName, outcome, durationMs);
    span?.end();
  }
}
