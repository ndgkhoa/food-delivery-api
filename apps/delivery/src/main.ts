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

/**
 * Delivery serves an HTTP read API (nearby drivers + assignment) AND a Socket.IO
 * WebSocket gateway for live driver location, plus a background `order.events`
 * consumer that assigns drivers to confirmed orders. HTTP is reached via the
 * gateway proxy; WS clients connect DIRECT to this port (Nginx WS-upgrade + TLS
 * is a later infra step). The Socket.IO server uses the Redis adapter so
 * broadcasts fan out across instances.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  // Unified error envelope for every 4xx/5xx response across all services.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Drain Redis + the Kafka consumer + WS clients on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Scale Socket.IO across instances via the Redis pub/sub adapter.
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
