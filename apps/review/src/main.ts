import 'reflect-metadata';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@review/app.module';
import { setupOpenApi } from '@review/interface/http/setup-openapi';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Review is HTTP-only (no gRPC server of its own) — it is only reached by
 * other services (or the gateway) over HTTP; its own Kafka edge (eligibility
 * consumer + outbox relay) is internal messaging, not an RPC surface.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupOpenApi(app);

  const port = process.env.PORT ?? 3009;
  await app.listen(port);
  Logger.log(`review listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`review API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
