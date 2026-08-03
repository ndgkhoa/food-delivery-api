import '@order/instrumentation';
import 'reflect-metadata';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@order/app.module';
import { setupOpenApi } from '@order/interface/http/setup-openapi';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Order is HTTP-only (no gRPC server of its own) — it calls catalog and
 * inventory as a gRPC CLIENT (see `GrpcClientsModule`), but is only reached
 * by other services through the gateway's reverse proxy over HTTP.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  // Unified error envelope for every 4xx/5xx response across all services.
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupOpenApi(app);

  // Under k8s a rolling update sends SIGTERM; enabling Nest's shutdown hooks
  // lets the payment/inventory reply consumers, the outbox relay, and the
  // saga reaper disconnect/stop cleanly via onModuleDestroy instead of being
  // hard-killed mid-poll (which would strand an uncommitted Kafka offset).
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  Logger.log(`order listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`order API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`order failed to bootstrap: ${error}`, 'Bootstrap');
  process.exit(1);
});
