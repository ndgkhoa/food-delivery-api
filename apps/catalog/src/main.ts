import '@catalog/instrumentation';
import 'reflect-metadata';
import { AppModule } from '@catalog/app.module';
import { setupOpenApi } from '@catalog/interface/http/setup-openapi';
import {
  CATALOG_GRPC_PACKAGE,
  catalogProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { GlobalExceptionFilter } from '@food-delivery-api/shared-errors';
import { correlationIdMiddleware } from '@food-delivery-api/shared-logging';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
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

  // Hybrid app: keep the public HTTP surface AND add an internal gRPC server so
  // east-west callers (order/inventory) can validate menu items. gRPC is
  // internal-only — never exposed through Nginx. PROTO_LOADER_OPTIONS maps
  // snake_case proto fields to camelCase JS (matching the hand-written contract
  // types) and materialises empty repeated fields as [] rather than undefined.
  const grpcUrl = process.env.CATALOG_GRPC_URL ?? '0.0.0.0:50051';
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: CATALOG_GRPC_PACKAGE,
        protoPath: catalogProtoPath(),
        url: grpcUrl,
        loader: PROTO_LOADER_OPTIONS,
      },
    },
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();

  // Under k8s a rolling update sends SIGTERM; enabling Nest's shutdown hooks
  // lets the catalog/review projection Kafka consumers disconnect cleanly via
  // onModuleDestroy instead of being hard-killed mid-poll (which would strand
  // an uncommitted offset and cause a duplicate redelivery on the new pod).
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  Logger.log(`catalog listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`catalog API reference at http://localhost:${port}/api/v1/reference`, 'Bootstrap');
  Logger.log(`catalog gRPC listening on ${grpcUrl}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`catalog failed to bootstrap: ${error}`, 'Bootstrap');
  process.exit(1);
});
