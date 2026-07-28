import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@payment/app.module';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Payment is a headless Kafka worker — no HTTP or gRPC surface. An application
 * context boots the module graph (firing the consumer + relay bootstrap hooks);
 * the process stays alive on the Kafka consumer connection. Shutdown hooks let
 * the consumer disconnect + relay stop cleanly on SIGTERM/SIGINT.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  Logger.log('payment stub worker started (consuming payment.commands)', 'Bootstrap');
}

bootstrap();
