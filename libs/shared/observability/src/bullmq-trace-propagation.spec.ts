import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  BULLMQ_TRACEPARENT_KEY,
  injectJobTraceContext,
  runJobWithTrace,
  stripJobTraceContext,
} from './bullmq-trace-propagation';

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

function registerTestMetrics(): {
  exporter: InMemoryMetricExporter;
  reader: PeriodicExportingMetricReader;
  provider: MeterProvider;
} {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return { exporter, reader, provider };
}

function readTraceparent(data: object): string | undefined {
  const value = (data as Record<string, unknown>)[BULLMQ_TRACEPARENT_KEY];
  return typeof value === 'string' ? value : undefined;
}

async function collectBullmqJobDuration(
  exporter: InMemoryMetricExporter,
  reader: PeriodicExportingMetricReader,
) {
  await reader.forceFlush();
  const points: { value: number; attributes: Record<string, unknown> }[] = [];
  for (const rm of exporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'bullmq_job_duration_ms') {
          continue;
        }
        for (const p of m.dataPoints) {
          points.push({ value: (p.value as { count: number }).count, attributes: p.attributes });
        }
      }
    }
  }
  return points;
}

describe('injectJobTraceContext', () => {
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

  it('adds __traceparent carrying the active span trace id', async () => {
    const tracer = trace.getTracer('test-enqueue');
    let traceId = '';
    let result: { notificationId: string } = { notificationId: 'n-1' };

    await tracer.startActiveSpan('enqueue-request', async (span) => {
      traceId = span.spanContext().traceId;
      result = injectJobTraceContext({ notificationId: 'n-1' });
      span.end();
    });

    expect(readTraceparent(result)).toBeDefined();
    expect(readTraceparent(result)).toContain(traceId);
    expect(result.notificationId).toBe('n-1');
  });

  it('still adds __traceparent (from its own span) when there is no ambient active span', () => {
    const data = { mediaId: 'm-1' };
    const result = injectJobTraceContext(data);
    expect(readTraceparent(result)).toBeDefined();
  });

  it('never throws and returns data unchanged if starting the span itself fails', () => {
    const data = { mediaId: 'm-1' };
    const brokenTracer = {
      startActiveSpan: () => {
        throw new Error('provider unavailable');
      },
    };
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValueOnce(brokenTracer as unknown as ReturnType<typeof trace.getTracer>);

    let result: typeof data | undefined;
    expect(() => {
      result = injectJobTraceContext(data);
    }).not.toThrow();
    expect(result).toEqual(data);
    expect(result ? readTraceparent(result) : undefined).toBeUndefined();
  });

  it('returns data unchanged (no key added) when no traceparent is produced', () => {
    jest.spyOn(propagation, 'inject').mockImplementationOnce(() => {
      // no-op: leaves the carrier empty
    });
    const data = { mediaId: 'm-1' };
    const result = injectJobTraceContext(data);
    expect(result).toEqual(data);
    expect(Object.hasOwn(result, BULLMQ_TRACEPARENT_KEY)).toBe(false);
  });
});

describe('runJobWithTrace', () => {
  let exporter: InMemorySpanExporter;
  let contextManager: AsyncHooksContextManager;
  let metricExporter: InMemoryMetricExporter;
  let metricReader: PeriodicExportingMetricReader;
  let metricProvider: MeterProvider;

  beforeEach(() => {
    ({ exporter, contextManager } = registerTestTracing());
    ({
      exporter: metricExporter,
      reader: metricReader,
      provider: metricProvider,
    } = registerTestMetrics());
  });

  afterEach(async () => {
    contextManager.disable();
    trace.disable();
    context.disable();
    propagation.disable();
    await metricProvider.shutdown();
    metrics.disable();
    jest.restoreAllMocks();
  });

  it('runs fn and returns its resolved value', async () => {
    const result = await runJobWithTrace({}, 'notify-email', async () => 'sent');
    expect(result).toBe('sent');
  });

  it('parents the process span to the trace id carried in the injected traceparent', async () => {
    const tracer = trace.getTracer('test-enqueue');
    let enqueueTraceId = '';
    let jobData: Record<string, unknown> = {};

    await tracer.startActiveSpan('enqueue-request', async (span) => {
      enqueueTraceId = span.spanContext().traceId;
      jobData = injectJobTraceContext({ notificationId: 'n-1' });
      span.end();
    });

    let processTraceId = '';
    await runJobWithTrace(jobData, 'notify-email', async () => {
      processTraceId = trace.getActiveSpan()?.spanContext().traceId ?? '';
    });

    const finishedSpans = exporter.getFinishedSpans();
    const enqueueSpan = finishedSpans.find((s) => s.name === 'bullmq.enqueue');
    const processSpan = finishedSpans.find((s) => s.name === 'bullmq.process');

    expect(processTraceId).toBe(enqueueTraceId);
    expect(enqueueSpan).toBeDefined();
    expect(processSpan).toBeDefined();
    expect(processSpan?.parentSpanContext?.spanId).toBe(enqueueSpan?.spanContext().spanId);
  });

  it('runs fn untraced (still returning its value) when jobData carries no traceparent', async () => {
    const result = await runJobWithTrace({ notificationId: 'n-1' }, 'notify-sms', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('propagates a fn rejection exactly once — never re-runs fn — and still records the failed metric + ends the span', async () => {
    const rejection = new Error('send failed');
    const failingFn = jest.fn().mockRejectedValue(rejection);

    await expect(runJobWithTrace({}, 'notify-push', failingFn)).rejects.toBe(rejection);
    expect(failingFn).toHaveBeenCalledTimes(1);

    const finishedSpans = exporter.getFinishedSpans();
    const processSpan = finishedSpans.find((s) => s.name === 'bullmq.process');
    expect(processSpan).toBeDefined();

    const points = await collectBullmqJobDuration(metricExporter, metricReader);
    const failed = points.find((p) => p.attributes.outcome === 'failed');
    expect(failed).toBeDefined();
    expect(failed?.attributes.queue).toBe('notify-push');
  });

  it('records the completed metric once on success', async () => {
    await runJobWithTrace({}, 'thumbnail', async () => 'done');
    const points = await collectBullmqJobDuration(metricExporter, metricReader);
    const completed = points.find((p) => p.attributes.outcome === 'completed');
    expect(completed).toBeDefined();
    expect(completed?.attributes.queue).toBe('thumbnail');
  });

  it('never throws from the tracing setup — falls back to running fn untraced when span setup fails', async () => {
    jest.spyOn(trace, 'getTracer').mockReturnValueOnce({
      startSpan: () => {
        throw new Error('provider unavailable');
      },
    } as unknown as ReturnType<typeof trace.getTracer>);

    const fn = jest.fn().mockResolvedValue('handled');
    await expect(runJobWithTrace({}, 'notify-email', fn)).resolves.toBe('handled');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never throws recording the metric even if the meter is broken — fn result still returns', async () => {
    jest.spyOn(metrics, 'getMeter').mockImplementation(() => {
      throw new Error('meter provider unavailable');
    });
    await expect(runJobWithTrace({}, 'notify-email', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('stripJobTraceContext', () => {
  it('removes the reserved key without mutating the input', () => {
    const input = { notificationId: 'n1', [BULLMQ_TRACEPARENT_KEY]: '00-abc-def-01' };
    const stripped = stripJobTraceContext(input);
    expect(stripped).toEqual({ notificationId: 'n1' });
    expect(BULLMQ_TRACEPARENT_KEY in stripped).toBe(false);
    expect(input[BULLMQ_TRACEPARENT_KEY]).toBe('00-abc-def-01');
  });

  it('returns data unchanged when the key is absent', () => {
    const input = { mediaId: 'm1' };
    expect(stripJobTraceContext(input)).toEqual({ mediaId: 'm1' });
  });
});
