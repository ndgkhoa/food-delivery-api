import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

const logger = new Logger('Telemetry');

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';
/** How often metrics are pushed to the Collector — cheap + always-on when telemetry is on. */
const METRIC_EXPORT_INTERVAL_MS = 15_000;

/**
 * Reads the OTel enable/disable switch straight from `process.env` rather than
 * a validated config service: this module runs BEFORE `ConfigModule` (before
 * `NestFactory` even exists), so no validated config is available yet. Off by
 * default under `NODE_ENV=test` so the unit/e2e suites never try to reach a
 * Collector; `TELEMETRY_ENABLED=false` is the explicit escape hatch for any
 * other environment (e.g. a constrained CI runner).
 */
function isTelemetryEnabled(): boolean {
  if (process.env.TELEMETRY_ENABLED === 'false') {
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  return true;
}

let sdk: NodeSDK | null = null;
let meterProvider: MeterProvider | null = null;
let shutdownHookRegistered = false;

/**
 * Starts the process-wide OpenTelemetry `NodeSDK` — auto-instrumentation
 * (HTTP/Express/gRPC/pg/ioredis, `fs` excluded as unusably noisy), an
 * OTLP-HTTP trace exporter, AND an OTLP-HTTP metric reader — tagging every
 * span/metric with `service.name` so Jaeger/Prometheus can distinguish the 13
 * services. Metrics ride the SAME SDK/exporter endpoint as traces (DRY — no
 * second prom-client stack): auto-instrumentation's `http.server.request.duration`
 * histogram gives the golden signals (rate/errors/latency) for free, and
 * `metrics.ts`'s business instruments (orders placed, revenue, saga outcome,
 * DLQ depth) ride the same meter provider. Call this as the FIRST statement a
 * service executes (via a per-app `instrumentation.ts` imported before
 * anything else in `main.ts`) so `require-in-the-middle` patches
 * `http`/`express`/`pg`/etc. before the app itself requires them — start it
 * later and auto-instrumentation silently misses every module already loaded.
 *
 * Never throws: a missing/unreachable Collector, a bad endpoint, or any SDK
 * start failure is logged and swallowed so tracing/metrics can never crash a
 * service's boot or its business flow (order placement, saga processing, ...).
 */
export function registerTracing(serviceName: string): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  if (sdk) {
    // Already started for this process (e.g. a second accidental import) — no-op.
    return;
  }

  try {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT;
    const resource = resourceFromAttributes({ 'service.name': serviceName });

    // Build the meter provider EXPLICITLY and register it as the API global
    // ourselves, rather than handing `NodeSDK` a `metricReader` and letting it
    // do so. When NodeSDK sets up traces + auto-instrumentations + a metric
    // reader together, its own global-meter registration does not reliably win,
    // leaving `metrics.getMeter()` (what `metrics.ts`'s business instruments
    // resolve) a permanent no-op — auto-instrumentation metrics still flow (they
    // get the provider directly) but every custom counter silently vanishes.
    // Registering the global up-front, before start, makes both paths use this
    // one provider deterministically. The auto-instrumentations then read this
    // same global (NodeSDK is given no metric reader of its own).
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
          exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    const instance = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // The single noisiest default instrumentation (every fs.readFile/stat
          // call becomes a span) — every other auto-instrumentation (http,
          // express, grpc, pg, ioredis, ...) stays on.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    // `start()` is synchronous in this SDK line, but guard for a thenable
    // anyway so a future/older version's async start can't produce an
    // unhandled rejection.
    const startResult = instance.start() as unknown;
    if (startResult && typeof (startResult as Promise<void>).catch === 'function') {
      (startResult as Promise<void>).catch((error: unknown) => logStartFailure(error));
    }

    sdk = instance;
    registerShutdownHook();
    logger.log(`tracing started for "${serviceName}" -> ${otlpEndpoint}`);
  } catch (error) {
    logStartFailure(error);
  }
}

function logStartFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  logger.warn(`tracing failed to start, continuing without it: ${detail}`);
}

function registerShutdownHook(): void {
  if (shutdownHookRegistered) {
    return;
  }
  shutdownHookRegistered = true;
  process.once('SIGTERM', () => {
    // AWAIT both the SDK (traces) and the separately-owned meter provider so the
    // final span/metric batch is actually flushed before the process exits — a
    // fire-and-forget shutdown often loses it. `allSettled` so one failing leg
    // never blocks the other; neither rejection escapes.
    void Promise.allSettled([sdk?.shutdown(), meterProvider?.shutdown()]).then((results) => {
      const labels = ['tracing', 'metrics'];
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          const detail =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.warn(`${labels[i]} shutdown failed: ${detail}`);
        }
      });
    });
  });
}
