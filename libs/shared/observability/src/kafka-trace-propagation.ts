import { Logger } from '@nestjs/common';
import { type Context, context, propagation, type Span, SpanKind, trace } from '@opentelemetry/api';

const logger = new Logger('Telemetry');
const TRACER_NAME = 'kafka-messaging';

type RawHeaderValue = Buffer | string | (Buffer | string)[] | undefined;
export type RawKafkaHeaderMap = Record<string, RawHeaderValue>;

function toStringValue(value: RawHeaderValue): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined) {
    return undefined;
  }
  return Buffer.isBuffer(single) ? single.toString('utf8') : single;
}

const rawHeaderGetter = {
  keys(carrier: RawKafkaHeaderMap): string[] {
    return Object.keys(carrier);
  },
  get(carrier: RawKafkaHeaderMap, key: string): string | undefined {
    return toStringValue(carrier[key]);
  },
};

export function injectTraceContext(headers: Record<string, string>): void {
  try {
    trace
      .getTracer(TRACER_NAME)
      .startActiveSpan('kafka.publish', { kind: SpanKind.PRODUCER }, (span: Span) => {
        try {
          propagation.inject(context.active(), headers, {
            set(carrier, key, value) {
              carrier[key] = value;
            },
          });
        } finally {
          span.end();
        }
      });
  } catch (error) {
    logger.warn(`failed to inject trace context, publishing without it: ${reasonOf(error)}`);
  }
}

export function captureActiveTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  try {
    propagation.inject(context.active(), carrier, {
      set(target, key, value) {
        target[key] = value;
      },
    });
  } catch (error) {
    logger.warn(`failed to capture trace context: ${reasonOf(error)}`);
  }
  return carrier;
}

export async function runWithExtractedContext<T>(
  headers: RawKafkaHeaderMap | undefined,
  spanName: string,
  fn: () => Promise<T>,
): Promise<T> {
  let span: Span;
  let activeContext: Context;
  try {
    const extracted = propagation.extract(context.active(), headers ?? {}, rawHeaderGetter);
    span = trace.getTracer(TRACER_NAME).startSpan(spanName, { kind: SpanKind.CONSUMER }, extracted);
    activeContext = trace.setSpan(extracted, span);
  } catch (error) {
    logger.warn(`failed to extract trace context, processing without it: ${reasonOf(error)}`);
    return fn();
  }
  try {
    return await context.with(activeContext, fn);
  } finally {
    span.end();
  }
}

export async function runWithTraceParent<T>(
  traceParent: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceParent) {
    return fn();
  }
  let ctx: Context;
  try {
    ctx = propagation.extract(context.active(), { traceparent: traceParent });
  } catch (error) {
    logger.warn(
      `failed to activate captured trace context, running without it: ${reasonOf(error)}`,
    );
    return fn();
  }
  return context.with(ctx, fn);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
