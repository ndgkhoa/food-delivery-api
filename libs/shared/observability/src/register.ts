import { Logger } from '@nestjs/common';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

const logger = new Logger('Telemetry');

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

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
let shutdownHookRegistered = false;

/**
 * Starts the process-wide OpenTelemetry `NodeSDK` — auto-instrumentation
 * (HTTP/Express/gRPC/pg/ioredis, `fs` excluded as unusably noisy) + an
 * OTLP-HTTP trace exporter — tagging every span with `service.name` so Jaeger
 * can distinguish the 13 services. Call this as the FIRST statement a service
 * executes (via a per-app `instrumentation.ts` imported before anything else
 * in `main.ts`) so `require-in-the-middle` patches `http`/`express`/`pg`/etc.
 * before the app itself requires them — start it later and auto-instrumentation
 * silently misses every module already loaded.
 *
 * Never throws: a missing/unreachable Collector, a bad endpoint, or any SDK
 * start failure is logged and swallowed so tracing can never crash a service's
 * boot or its business flow (order placement, saga processing, ...).
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

    const instance = new NodeSDK({
      resource: resourceFromAttributes({ 'service.name': serviceName }),
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
    sdk?.shutdown().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn(`tracing shutdown failed: ${detail}`);
    });
  });
}
