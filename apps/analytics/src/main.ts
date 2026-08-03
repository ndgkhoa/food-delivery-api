import '@analytics/instrumentation';
import 'reflect-metadata';
import { AppModule } from '@analytics/app.module';
import { setupOpenApi } from '@analytics/interface/http/setup-openapi';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Analytics is an HTTP dashboard API (revenue/top-restaurants/summary) plus a
 * background `order.events` ingest consumer feeding its ClickHouse read
 * model. It is only reached by clients through the gateway's reverse proxy
 * over HTTP.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  // Unified error envelope for every 4xx/5xx response across all services.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Drain the ClickHouse client + Kafka consumer on SIGTERM/SIGINT instead of dropping them.
  app.enableShutdownHooks();

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupOpenApi(app);

  const port = process.env.PORT ?? 3010;
  await app.listen(port);
  Logger.log(`analytics listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`analytics API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
