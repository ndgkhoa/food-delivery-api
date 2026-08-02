import '@notification/instrumentation';
import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@notification/app.module';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Notification has no public API: it boots a Kafka consumer (`order.events`)
 * and per-channel BullMQ workers from providers' `onApplicationBootstrap`
 * hooks, kept alive by their own long-lived broker connections. It DOES run a
 * minimal HTTP listener (rather than `createApplicationContext`) solely so
 * k8s can probe `GET /api/v1/health` — no other HTTP routes exist. Shutdown
 * hooks drain the consumer, workers, and Postgres pool on SIGTERM/SIGINT.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3012;
  await app.listen(port);
  Logger.log(
    `notification health listening on http://localhost:${port}/api/v1/health`,
    'Bootstrap',
  );
  Logger.log('notification consuming order.events (no other HTTP/gRPC surface)', 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
