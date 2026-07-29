import 'reflect-metadata';
import { AppModule } from '@config/app.module';
import { setupOpenApi } from '@config/interface/http/setup-openapi';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Config is an HTTP API for tenant-overridable business tunables + feature
 * flags. Reached by clients only through the gateway's reverse proxy over
 * HTTP; every other service reads it through the shared config-client library
 * (HTTP + a change-event cache), never this process directly.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));

  // Drains the Postgres pool + Kafka producer on SIGTERM/SIGINT.
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

  const port = process.env.PORT ?? 3008;
  await app.listen(port);
  Logger.log(`config listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`config API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
