import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@search/app.module';
import { setupOpenApi } from '@search/interface/http/setup-openapi';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Search is an HTTP query API (search + autocomplete) plus a background
 * `catalog.events` consumer that projects into Elasticsearch. It is only reached
 * by clients through the gateway's reverse proxy over HTTP.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));

  // Drain the ES pool + Kafka consumer on SIGTERM/SIGINT instead of dropping them.
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

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  Logger.log(`search listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`search API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
