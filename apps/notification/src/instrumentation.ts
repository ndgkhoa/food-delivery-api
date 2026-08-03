import { registerTracing } from '@food-delivery-api/shared-observability/register';

/**
 * Starts OpenTelemetry tracing for this service BEFORE anything else in
 * `main.ts` imports — must stay the first import there so auto-instrumentation
 * patches `http`/`express`/`grpc`/`pg`/`ioredis` before the app requires them.
 */
registerTracing('notification');
