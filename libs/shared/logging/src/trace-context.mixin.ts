import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

const logger = new Logger('Telemetry');

export interface TraceContextFields {
  trace_id: string;
  span_id: string;
}

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
