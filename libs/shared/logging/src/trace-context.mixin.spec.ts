import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { traceContextMixin } from './trace-context.mixin';

function registerTestTracing(): { contextManager: AsyncHooksContextManager } {
  trace.disable();
  context.disable();
  propagation.disable();

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  const contextManager = new AsyncHooksContextManager().enable();

  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  return { contextManager };
}

describe('traceContextMixin', () => {
  let contextManager: AsyncHooksContextManager;

  beforeEach(() => {
    ({ contextManager } = registerTestTracing());
  });

  afterEach(() => {
    contextManager.disable();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('adds trace_id and span_id when a span is active', async () => {
    const tracer = trace.getTracer('test-logging');
    let fields: ReturnType<typeof traceContextMixin> = {};
    let expectedTraceId = '';
    let expectedSpanId = '';

    await tracer.startActiveSpan('handler', async (span) => {
      expectedTraceId = span.spanContext().traceId;
      expectedSpanId = span.spanContext().spanId;
      fields = traceContextMixin();
      span.end();
    });

    expect(fields).toEqual({ trace_id: expectedTraceId, span_id: expectedSpanId });
  });

  it('returns an empty object when there is no active span', () => {
    expect(traceContextMixin()).toEqual({});
  });

  it('never throws and returns an empty object when reading the span fails', () => {
    jest.spyOn(trace, 'getActiveSpan').mockImplementationOnce(() => {
      throw new Error('provider unavailable');
    });

    expect(() => traceContextMixin()).not.toThrow();
    expect(traceContextMixin()).toEqual({});
  });
});
