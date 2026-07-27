import 'reflect-metadata';
import { AppModule } from '@auth/app.module';
import { setupOpenApi } from '@auth/interface/http/setup-openapi';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

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

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  Logger.log(`auth listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`auth API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
}

bootstrap();
