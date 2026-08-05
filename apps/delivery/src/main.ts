import '@delivery/instrumentation';
import 'reflect-metadata';
import { AppModule } from '@delivery/app.module';
import { RedisIoAdapter } from '@delivery/infrastructure/ws/redis-io-adapter';
import { setupOpenApi } from '@delivery/interface/http/setup-openapi';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  const redisUrl = app.get(ConfigService).getOrThrow<string>('REDIS_URL');
  const wsAdapter = new RedisIoAdapter(app, redisUrl);
  await wsAdapter.connect();
  app.useWebSocketAdapter(wsAdapter);

  setupOpenApi(app);

  const port = process.env.PORT ?? 3005;
  await app.listen(port);
  Logger.log(`delivery listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`delivery API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
  Logger.log(`delivery WebSocket on ws://localhost:${port} (Socket.IO)`, 'Bootstrap');
}

bootstrap();
