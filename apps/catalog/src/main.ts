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
