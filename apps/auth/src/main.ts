import '@auth/instrumentation';
import 'reflect-metadata';
import { AppModule } from '@auth/app.module';
import { setupOpenApi } from '@auth/interface/http/setup-openapi';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

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
  // lets TypeORM/Redis close their connections via onModuleDestroy instead of
  // being hard-killed mid-request.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  Logger.log(`auth listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`auth API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`auth failed to bootstrap: ${error}`, 'Bootstrap');
  process.exit(1);
});
