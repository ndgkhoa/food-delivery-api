import '@inventory/instrumentation';
import 'reflect-metadata';
import {
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { AppModule } from '@inventory/app.module';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Inventory's primary surface is gRPC (order's manual cancel/release path
 * calls it east-west) — the hybrid HTTP listener added here exists SOLELY so
 * k8s can probe `GET /api/v1/health`; inventory has no other HTTP routes.
 * PROTO_LOADER_OPTIONS maps snake_case proto fields to camelCase JS (matching
 * the hand-written contract types the controller implements) and materialises
 * empty repeated fields as [] rather than undefined.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Must run before pino-http's own middleware so `genReqId` reads a normalized header.
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api/v1');

  const grpcUrl = process.env.INVENTORY_GRPC_URL ?? '0.0.0.0:50052';
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: INVENTORY_GRPC_PACKAGE,
        protoPath: inventoryProtoPath(),
        url: grpcUrl,
        loader: PROTO_LOADER_OPTIONS,
      },
    },
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();

  // Under k8s a rolling update sends SIGTERM; enabling Nest's shutdown hooks lets
  // the gRPC server + Kafka consumers drain via their onModuleDestroy handlers
  // instead of being hard-killed mid-request/mid-poll.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3011;
  await app.listen(port);
  Logger.log(`inventory gRPC listening on ${grpcUrl}`, 'Bootstrap');
  Logger.log(`inventory health listening on http://localhost:${port}/api/v1/health`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`inventory failed to bootstrap: ${error}`, 'Bootstrap');
  process.exit(1);
});
