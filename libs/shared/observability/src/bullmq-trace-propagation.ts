import { Logger } from '@nestjs/common';
import { type Context, context, propagation, type Span, SpanKind, trace } from '@opentelemetry/api';
import { recordBullmqJob } from './metrics';

const logger = new Logger('Telemetry');
const TRACER_NAME = 'bullmq-messaging';

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

export function stripJobTraceContext<T extends object>(data: T): T {
  if (!(BULLMQ_TRACEPARENT_KEY in data)) {
    return data;
  }
  const rest = { ...data } as Record<string, unknown>;
  delete rest[BULLMQ_TRACEPARENT_KEY];
  return rest as T;
}

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
    span = trace
      .getTracer(TRACER_NAME)
      .startSpan('bullmq.process', { kind: SpanKind.CONSUMER }, extracted);
    activeContext = trace.setSpan(extracted, span);
  } catch (error) {
    logger.warn(
      `failed to extract trace context for ${queueName}, processing without it: ${reasonOf(error)}`,
    );
    return timeAndRecord(queueName, fn);
  }
  return timeAndRecord(queueName, () => context.with(activeContext, fn), span);
}

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
