import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

const logger = new Logger('Telemetry');

/** Fields `traceContextMixin` adds to a log line when a span is active. */
export interface TraceContextFields {
  trace_id: string;
  span_id: string;
}

/**
 * A pino `mixin` (called for every log line) that stamps `trace_id`/`span_id`
 * from the currently active OTel span, so a log line can be pivoted to its
 * Jaeger trace in Grafana Explore — `correlationId` (set separately via
 * `customProps`) already ties a line to its request, this ties it to its
 * trace. Returns `{}` when no span is active (telemetry disabled, a
 * background job with no active context, or no OTel provider registered in
 * this process) — the log line ships without the fields rather than with
 * garbage ones. Never throws: a broken tracer must never break logging.
 */
export function traceContextMixin(): Partial<TraceContextFields> {
  try {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!spanContext) {
      return {};
    }
    return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(`failed to read active span for log correlation: ${detail}`);
    return {};
  }
}
