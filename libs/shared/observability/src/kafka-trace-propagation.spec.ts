import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  captureActiveTraceContext,
  injectTraceContext,
  runWithExtractedContext,
  runWithTraceParent,
} from './kafka-trace-propagation';

/**
 * A real (in-memory) tracer provider + W3C propagator + async-hooks context
 * manager registered as the global OTel API implementation, so
 * `injectTraceContext`/`runWithExtractedContext` (which call the plain
 * `@opentelemetry/api` globals, same as production code) exercise real span
 * contexts instead of the no-op default. No Collector/network involved.
 */
function registerTestTracing(): {
  exporter: InMemorySpanExporter;
  contextManager: AsyncHooksContextManager;
} {
  trace.disable();
  context.disable();
  propagation.disable();

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const contextManager = new AsyncHooksContextManager().enable();

  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  return { exporter, contextManager };
}

describe('injectTraceContext', () => {
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

  it("writes a traceparent header carrying the active span's trace id", async () => {
    const tracer = trace.getTracer('test-producer');
    const headers: Record<string, string> = {};
    let traceId = '';

    await tracer.startActiveSpan('publish', async (span) => {
      traceId = span.spanContext().traceId;
      injectTraceContext(headers);
      span.end();
    });

    expect(headers.traceparent).toBeDefined();
    expect(headers.traceparent).toContain(traceId);
  });

  it('still writes a traceparent (from its own span) when there is no ambient active span', () => {
    // Mirrors an outbox-relay publish tick: nothing is active when the relay
    // fires, but the message must still carry a trace header for the
    // consumer to parent to — injectTraceContext starts its own span rather
    // than depending on ambient context.
    const headers: Record<string, string> = {};
    expect(() => injectTraceContext(headers)).not.toThrow();
    expect(headers.traceparent).toBeDefined();
  });

  it('never throws even if starting the span itself fails', () => {
    const headers: Record<string, string> = {};
    const brokenTracer = {
      startActiveSpan: () => {
        throw new Error('provider unavailable');
      },
    };
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValueOnce(brokenTracer as unknown as ReturnType<typeof trace.getTracer>);

    expect(() => injectTraceContext(headers)).not.toThrow();
    expect(headers.traceparent).toBeUndefined();
  });
});

describe('captureActiveTraceContext', () => {
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

  it("captures the active span's traceparent without starting a new span", async () => {
    const tracer = trace.getTracer('test-outbox-append');
    let traceId = '';
    let captured: Record<string, string> = {};

    await tracer.startActiveSpan('handler', async (span) => {
      traceId = span.spanContext().traceId;
      captured = captureActiveTraceContext();
      span.end();
    });

    expect(captured.traceparent).toBeDefined();
    expect(captured.traceparent).toContain(traceId);
  });

  it('returns an empty object when there is no active span', () => {
    expect(captureActiveTraceContext()).toEqual({});
  });

  it('never throws even if injection itself fails', () => {
    jest.spyOn(propagation, 'inject').mockImplementationOnce(() => {
      throw new Error('propagator unavailable');
    });

    expect(() => captureActiveTraceContext()).not.toThrow();
    expect(captureActiveTraceContext()).toEqual({});
  });
});

describe('runWithTraceParent', () => {
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

  it('re-activates a captured traceparent so work inside sees the original trace id', async () => {
    // Capture from one span, then — with NO active span (the Temporal-worker
    // situation) — re-activate it and confirm the inner capture round-trips the id.
    const tracer = trace.getTracer('test-client');
    let originalTraceId = '';
    let captured: Record<string, string> = {};

    await tracer.startActiveSpan('client-start', async (span) => {
      originalTraceId = span.spanContext().traceId;
      captured = captureActiveTraceContext();
      span.end();
    });

    let innerTraceId = '';
    await runWithTraceParent(captured.traceparent, async () => {
      innerTraceId = trace.getSpanContext(context.active())?.traceId ?? '';
      // The outbox writer's own capture, run inside this reactivated context.
      expect(captureActiveTraceContext().traceparent).toContain(originalTraceId);
    });

    expect(innerTraceId).toBe(originalTraceId);
  });

  it('runs the function unchanged when there is no traceparent', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(runWithTraceParent(undefined, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never throws on a malformed traceparent — still runs the function', async () => {
    const fn = jest.fn().mockResolvedValue('done');
    await expect(runWithTraceParent('not-a-valid-traceparent', fn)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates a business error from fn exactly once — never re-runs it', async () => {
    // A failure in the wrapped work is NOT a tracing failure: it must surface to
    // the caller, and fn must run only once (no double-execution via a catch).
    const fn = jest.fn().mockRejectedValue(new Error('db write failed'));
    await expect(
      runWithTraceParent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', fn),
    ).rejects.toThrow('db write failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('runWithExtractedContext', () => {
  let exporter: InMemorySpanExporter;
  let contextManager: AsyncHooksContextManager;

  beforeEach(() => {
    ({ exporter, contextManager } = registerTestTracing());
  });

  afterEach(() => {
    contextManager.disable();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('starts a consumer span that is a child of the injected trace (same trace id)', async () => {
    const tracer = trace.getTracer('test-producer');
    const headers: Record<string, string> = {};
    let producerTraceId = '';

    await tracer.startActiveSpan('publish', async (span) => {
      producerTraceId = span.spanContext().traceId;
      injectTraceContext(headers);
      span.end();
    });

    let consumerTraceId = '';
    await runWithExtractedContext(headers, 'consume', async () => {
      consumerTraceId = trace.getActiveSpan()?.spanContext().traceId ?? '';
    });

    // Read back the finished spans via the exporter (the public `ReadableSpan`
    // shape) rather than the live `Span` object, which doesn't expose its
    // parent on the public API surface. `injectTraceContext` starts its own
    // "kafka.publish" span around the injection, so that — not the outer
    // "publish" span — is what "consume" is actually parented to.
    const finishedSpans = exporter.getFinishedSpans();
    const publishSpan = finishedSpans.find((s) => s.name === 'kafka.publish');
    const consumeSpan = finishedSpans.find((s) => s.name === 'consume');

    expect(consumerTraceId).toBe(producerTraceId);
    expect(publishSpan).toBeDefined();
    expect(consumeSpan).toBeDefined();
    expect(consumeSpan?.parentSpanContext?.spanId).toBe(publishSpan?.spanContext().spanId);
  });

  it('still runs the handler and returns its result when headers carry no traceparent', async () => {
    const result = await runWithExtractedContext(undefined, 'consume', async () => 'handled');
    expect(result).toBe('handled');
  });

  it('propagates a handler rejection exactly once — never re-runs the handler', async () => {
    // A handler failure is business, not tracing: it must surface AND run only
    // once. The old catch-then-`return fn()` shape re-executed the handler on any
    // throw (and mislabelled it a tracing failure) — this guards against that.
    const fn = jest.fn().mockRejectedValue(new Error('handler failed'));
    await expect(runWithExtractedContext({}, 'consume', fn)).rejects.toThrow('handler failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
