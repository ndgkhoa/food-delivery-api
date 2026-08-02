import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { recordDlqMessage, recordOrderPlaced, recordSagaOutcome } from './metrics';

describe('business metrics helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    metrics.disable();
  });

  describe('with a real (in-memory) meter provider registered as the API global', () => {
    // Guards the production shape: `metrics.ts` resolves its instruments off the
    // API-global meter provider (`metrics.getMeter`). If that global is ever a
    // no-op (a real regression this project already hit), these record no data.
    // A never-throw-only test can't catch that — this asserts real datapoints
    // AND the exact label values reach an exporter.
    let exporter: InMemoryMetricExporter;
    let reader: PeriodicExportingMetricReader;
    let provider: MeterProvider;

    beforeEach(() => {
      exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
      reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
      provider = new MeterProvider({ readers: [reader] });
      metrics.setGlobalMeterProvider(provider);
    });

    afterEach(async () => {
      await provider.shutdown();
    });

    async function collect() {
      await reader.forceFlush();
      const byName = new Map<string, { value: number; attributes: Record<string, unknown> }[]>();
      for (const rm of exporter.getMetrics()) {
        for (const sm of rm.scopeMetrics) {
          for (const m of sm.metrics) {
            byName.set(
              m.descriptor.name,
              m.dataPoints.map((p) => ({ value: p.value as number, attributes: p.attributes })),
            );
          }
        }
      }
      return byName;
    }

    it('recordOrderPlaced increments the count and adds the revenue', async () => {
      recordOrderPlaced(1_999);
      const m = await collect();
      expect(m.get('orders_placed_total')?.[0]?.value).toBe(1);
      expect(m.get('order_revenue_cents_total')?.[0]?.value).toBe(1_999);
    });

    it('recordSagaOutcome records the outcome as a bounded label', async () => {
      recordSagaOutcome('cancelled');
      const points = (await collect()).get('saga_outcome_total');
      expect(points?.[0]?.value).toBe(1);
      expect(points?.[0]?.attributes).toEqual({ outcome: 'cancelled' });
    });

    it('recordDlqMessage records the source topic as a bounded label', async () => {
      recordDlqMessage('order.commands');
      const points = (await collect()).get('dlq_messages_total');
      expect(points?.[0]?.value).toBe(1);
      expect(points?.[0]?.attributes).toEqual({ topic: 'order.commands' });
    });
  });

  describe('with no meter provider registered (the default, e.g. under NODE_ENV=test)', () => {
    it('recordOrderPlaced never throws and is callable', () => {
      expect(() => recordOrderPlaced(1_999)).not.toThrow();
    });

    it('recordSagaOutcome never throws for each valid outcome', () => {
      expect(() => recordSagaOutcome('confirmed')).not.toThrow();
      expect(() => recordSagaOutcome('cancelled')).not.toThrow();
    });

    it('recordDlqMessage never throws and is callable', () => {
      expect(() => recordDlqMessage('order.commands')).not.toThrow();
    });
  });

  describe('when the underlying instrument call throws', () => {
    it('recordOrderPlaced swallows the error instead of propagating it', () => {
      jest.spyOn(metrics, 'getMeter').mockImplementationOnce(() => {
        throw new Error('meter provider unavailable');
      });

      expect(() => recordOrderPlaced(500)).not.toThrow();
    });

    it('recordSagaOutcome swallows the error instead of propagating it', () => {
      jest.spyOn(metrics, 'getMeter').mockImplementationOnce(() => {
        throw new Error('meter provider unavailable');
      });

      expect(() => recordSagaOutcome('confirmed')).not.toThrow();
    });

    it('recordDlqMessage swallows the error instead of propagating it', () => {
      jest.spyOn(metrics, 'getMeter').mockImplementationOnce(() => {
        throw new Error('meter provider unavailable');
      });

      expect(() => recordDlqMessage('inventory.replies')).not.toThrow();
    });
  });
});
