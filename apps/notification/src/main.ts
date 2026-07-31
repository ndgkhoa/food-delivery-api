import '@notification/instrumentation';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@notification/app.module';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Notification is headless: no HTTP or gRPC surface. It boots a Kafka
 * consumer (`order.events`) and per-channel BullMQ workers from providers'
 * `onApplicationBootstrap` hooks, kept alive by their own long-lived broker
 * connections. Shutdown hooks drain the consumer, workers, and Postgres pool
 * on SIGTERM/SIGINT.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  Logger.log('notification consuming order.events (no HTTP/gRPC surface)', 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
