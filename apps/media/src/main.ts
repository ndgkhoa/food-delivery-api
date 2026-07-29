import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { AppModule } from '@media/app.module';
import { setupOpenApi } from '@media/interface/http/setup-openapi';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Media is an HTTP API that issues presigned URLs for direct-to-MinIO uploads +
 * downloads and stores object metadata, plus a background BullMQ worker that
 * generates thumbnails. Reached by clients only through the gateway's reverse
 * proxy over HTTP.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));

  // Drain the Postgres pool, MinIO client, and the BullMQ queue + worker on SIGTERM/SIGINT.
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

  const port = process.env.PORT ?? 3006;
  await app.listen(port);
  Logger.log(`media listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`media API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
