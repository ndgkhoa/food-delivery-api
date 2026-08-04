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
const METRIC_EXPORT_INTERVAL_MS = 15_000;

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

export function registerTracing(serviceName: string): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  if (sdk) {
    return;
  }

  try {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT;
    const resource = resourceFromAttributes({ 'service.name': serviceName });

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
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

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
