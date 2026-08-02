import '@inventory/instrumentation';
import 'reflect-metadata';
import {
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { AppModule } from '@inventory/app.module';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Inventory is a pure gRPC microservice (no HTTP surface). PROTO_LOADER_OPTIONS
 * maps snake_case proto fields to camelCase JS (matching the hand-written
 * contract types the controller implements) and materialises empty repeated
 * fields as [] rather than undefined.
 */
async function bootstrap() {
  const grpcUrl = process.env.INVENTORY_GRPC_URL ?? '0.0.0.0:50052';
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: INVENTORY_GRPC_PACKAGE,
      protoPath: inventoryProtoPath(),
      url: grpcUrl,
      loader: PROTO_LOADER_OPTIONS,
    },
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));
  await app.listen();
  Logger.log(`inventory gRPC listening on ${grpcUrl}`, 'Bootstrap');
}

bootstrap();
