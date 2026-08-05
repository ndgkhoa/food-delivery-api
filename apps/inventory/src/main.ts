import '@inventory/instrumentation';
import 'reflect-metadata';
import {
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { AppModule } from '@inventory/app.module';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(correlationIdMiddleware);
  app.useLogger(app.get(PinoLogger));
  app.useGlobalFilters(new GlobalExceptionFilter());
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
