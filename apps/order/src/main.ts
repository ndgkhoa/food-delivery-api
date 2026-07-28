import 'reflect-metadata';
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

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupOpenApi(app);

  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  Logger.log(`order listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`order API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
