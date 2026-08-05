import '@review/instrumentation';
import 'reflect-metadata';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@review/app.module';
import { setupOpenApi } from '@review/interface/http/setup-openapi';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
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

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3009;
  await app.listen(port);
  Logger.log(`review listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`review API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`review failed to bootstrap: ${error}`, 'Bootstrap');
  process.exit(1);
});
