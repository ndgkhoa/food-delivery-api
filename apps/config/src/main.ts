import '@config/instrumentation';
import 'reflect-metadata';
import { AppModule } from '@config/app.module';
import { setupOpenApi } from '@config/interface/http/setup-openapi';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  app.useGlobalFilters(new GlobalExceptionFilter());

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
