import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  recordDlqMessage,
  recordOrderPlaced,
  recordSagaOutcome,
  recordSagaReconcileEscalated,
  recordSagaReconcileRedriven,
} from './metrics';

describe('business metrics helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    metrics.disable();
  });

  describe('with a real (in-memory) meter provider registered as the API global', () => {
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

    it('recordSagaReconcileRedriven records the re-driven-from state as a bounded label', async () => {
      recordSagaReconcileRedriven('STOCK_RESERVED');
      const points = (await collect()).get('saga_reconcile_redriven_total');
      expect(points?.[0]?.value).toBe(1);
      expect(points?.[0]?.attributes).toEqual({ state: 'STOCK_RESERVED' });
    });

    it('recordSagaReconcileEscalated increments the unlabeled escalation count', async () => {
      recordSagaReconcileEscalated();
      const points = (await collect()).get('saga_reconcile_escalated_total');
      expect(points?.[0]?.value).toBe(1);
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

    it('recordSagaReconcileRedriven never throws and is callable', () => {
      expect(() => recordSagaReconcileRedriven('STARTED')).not.toThrow();
    });

    it('recordSagaReconcileEscalated never throws and is callable', () => {
      expect(() => recordSagaReconcileEscalated()).not.toThrow();
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

    it('recordSagaReconcileRedriven swallows the error instead of propagating it', () => {
      jest.spyOn(metrics, 'getMeter').mockImplementationOnce(() => {
        throw new Error('meter provider unavailable');
      });

      expect(() => recordSagaReconcileRedriven('COMPENSATING')).not.toThrow();
    });

    it('recordSagaReconcileEscalated swallows the error instead of propagating it', () => {
      jest.spyOn(metrics, 'getMeter').mockImplementationOnce(() => {
        throw new Error('meter provider unavailable');
      });

      expect(() => recordSagaReconcileEscalated()).not.toThrow();
    });
  });
});
