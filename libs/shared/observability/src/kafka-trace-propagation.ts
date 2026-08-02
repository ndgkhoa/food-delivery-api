import { Logger } from '@nestjs/common';
import { type Context, context, propagation, type Span, SpanKind, trace } from '@opentelemetry/api';

const logger = new Logger('Telemetry');
const TRACER_NAME = 'kafka-messaging';

/** The header-value shapes the confluent Kafka client hands back on consume. */
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

/**
 * Writes a W3C trace context (`traceparent` + `tracestate`) onto an outbound
 * Kafka header map — ADDITIVE to the envelope's existing `x-*` identity
 * headers (correlationId untouched). Wraps the injection in its own short
 * PRODUCER span rather than relying solely on whatever happens to be active:
 * a DIRECT publish (issued synchronously inside a request) gets that span
 * parented under the request as expected, but an outbox-relay publish (fired
 * from an unrelated polling tick, with no request in flight) would otherwise
 * have no active span at all — `propagation.inject` writes nothing without
 * one, and the Kafka hop would carry no trace header whatsoever. Starting a
 * span here guarantees every publish, outbox-relayed or not, carries a valid
 * traceparent so the consumer can still parent to it (the producer -> consumer
 * boundary itself never breaks); it does mean an outbox-relayed message's
 * trace id will differ from the original request's — full single-trace-id
 * continuity across that async gap needs the traceparent captured at the
 * point the outbox row is WRITTEN, not at relay-publish time (a follow-up:
 * persist it as an outbox row column). Never throws: tracing must never
 * block or fail a publish.
 */
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

/**
 * Captures the CURRENTLY active W3C trace context into a plain header map
 * (`traceparent` only — `tracestate` is skipped: this single-collector dev
 * OTel setup never populates it, so carrying it would just be dead weight)
 * WITHOUT starting a span, unlike `injectTraceContext`. Meant for persisting
 * into an outbox row at WRITE time (synchronously, inside the request/handler
 * transaction), so a later relay-tick publish can forward the ORIGINAL
 * request's context instead of starting a fresh, disconnected trace — the
 * async DB-persist -> later-tick gap is exactly what a span started at
 * publish time (see `injectTraceContext`) can't bridge. Returns `{}` when no
 * span is active (telemetry disabled, or a test with no tracer registered) —
 * callers persist that as a null column and the producer's existing
 * `!headers.traceparent` fallback applies unchanged. Never throws: tracing
 * must never block or fail an append.
 */
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

/**
 * Extracts a W3C trace context from inbound Kafka headers (if present) and
 * runs `fn` inside a new CONSUMER span parented to that context, so the
 * handler and any spans it starts (pg/redis/grpc/outbound produce) attach to
 * the producing span's trace instead of starting a disconnected one. Falls
 * back to running `fn` with a fresh (unparented) span, or with no span at all,
 * when extraction/span-start fails — tracing must never break message
 * processing.
 */
export async function runWithExtractedContext<T>(
  headers: RawKafkaHeaderMap | undefined,
  spanName: string,
  fn: () => Promise<T>,
): Promise<T> {
  let span: Span;
  let activeContext: Context;
  try {
    const extracted = propagation.extract(context.active(), headers ?? {}, rawHeaderGetter);
    // Resolved fresh on every call (never cached at module scope): `register.ts`
    // starts the SDK and registers the real tracer provider on a service's
    // first import, but grabbing the tracer once at THIS module's own import
    // time can race that — a `Tracer` handed out before a provider is
    // registered stays a no-op forever, it does not "upgrade" later.
    span = trace.getTracer(TRACER_NAME).startSpan(spanName, { kind: SpanKind.CONSUMER }, extracted);
    activeContext = trace.setSpan(extracted, span);
  } catch (error) {
    // ONLY a tracing-SETUP failure reaches here — the handler has not run yet, so
    // running it once (untraced) is safe. `fn`'s OWN errors must NEVER be caught
    // here: they'd be mislabelled as tracing failures AND re-execute the handler.
    logger.warn(`failed to extract trace context, processing without it: ${reasonOf(error)}`);
    return fn();
  }
  // Setup succeeded: run the handler inside the consumer span exactly once — its
  // errors propagate untouched; the span is ended whether it resolves or throws.
  try {
    return await context.with(activeContext, fn);
  } finally {
    span.end();
  }
}

/**
 * Runs `fn` inside the OTel context carried by a previously-captured W3C
 * `traceparent` string — for a boundary where the ambient context is lost but
 * the originating one was captured earlier as plain data. Temporal is the case
 * that needs this: a workflow/activity runs on a detached worker with no active
 * span, yet the input carries the `traceparent` captured at the client start
 * (inside the triggering Kafka-consumer span). Reconstructing + activating it
 * here means anything inside `fn` — including `captureActiveTraceContext` in the
 * outbox writer, and auto-instrumented pg/redis calls — attaches to the original
 * trace instead of starting a disconnected one. With no `traceParent` (telemetry
 * off / never captured) `fn` runs unchanged. Never throws.
 */
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
    // ONLY a setup failure (bad propagator) reaches here — `fn` has not run. Its
    // own errors must propagate from `context.with` below, never be caught + re-run.
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
