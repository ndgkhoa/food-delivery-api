import {
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import {
  type InventoryTestDatabase,
  startInventoryTestDatabase,
  stopInventoryTestDatabase,
} from '@inventory/testing/inventory-test-database';
import { type INestApplication, type INestMicroservice, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  type OrderTestDatabase,
  startOrderTestDatabase,
  stopOrderTestDatabase,
} from '@order/testing/order-test-database';
import { type FakeCatalogGrpcServer, startFakeCatalogGrpcServer } from './fake-catalog-grpc-server';
import { type StartedRedis, startRedisContainer } from './start-redis-container';

/** Fixed loopback port for the in-process inventory microservice this stack boots. */
const INVENTORY_GRPC_URL = '127.0.0.1:50652';

export interface OrderStack {
  orderApp: INestApplication;
  orderDb: OrderTestDatabase;
  inventoryDb: InventoryTestDatabase;
  redis: StartedRedis;
  catalogServer: FakeCatalogGrpcServer;
  inventoryService: INestMicroservice;
}

/**
 * Boots the full synchronous-saga stack an order e2e test exercises: real
 * Postgres for BOTH order and inventory, real Redis (inventory's reserve
 * lock), a lightweight real in-process catalog gRPC server, and a real
 * in-process inventory gRPC microservice — then the order HTTP app, wired to
 * call both over genuine gRPC channels. Nothing in this chain is faked; only
 * the container placement (in-process vs. Docker) is a test convenience.
 *
 * `process.env` is mutated in two phases because each Nest app's
 * `ConfigModule` validates against whatever is in `process.env` at the moment
 * its container is bootstrapped — inventory is bootstrapped first (while env
 * points at ITS Postgres/Redis), then env is repointed at order's Postgres +
 * the two gRPC endpoints before order boots.
 */
export async function bootOrderStack(): Promise<OrderStack> {
  const orderDb = await startOrderTestDatabase();
  const inventoryDb = await startInventoryTestDatabase();
  const redis = await startRedisContainer();
  const catalogServer = await startFakeCatalogGrpcServer();

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';

  // Phase 1: boot inventory against its own Postgres + Redis.
  process.env.DB_HOST = inventoryDb.container.getHost();
  process.env.DB_PORT = String(inventoryDb.container.getPort());
  process.env.DB_USERNAME = inventoryDb.container.getUsername();
  process.env.DB_PASSWORD = inventoryDb.container.getPassword();
  process.env.DB_NAME = inventoryDb.container.getDatabase();
  process.env.REDIS_URL = redis.url;
  process.env.INVENTORY_GRPC_URL = INVENTORY_GRPC_URL;

  const { AppModule: InventoryAppModule } = await import('@inventory/app.module');
  const inventoryService = await NestFactory.createMicroservice<MicroserviceOptions>(
    InventoryAppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: INVENTORY_GRPC_PACKAGE,
        protoPath: inventoryProtoPath(),
        url: INVENTORY_GRPC_URL,
        loader: PROTO_LOADER_OPTIONS,
      },
      bufferLogs: true,
    },
  );
  await inventoryService.listen();

  // Phase 2: boot order against its own Postgres + the two gRPC endpoints above.
  process.env.DB_HOST = orderDb.container.getHost();
  process.env.DB_PORT = String(orderDb.container.getPort());
  process.env.DB_USERNAME = orderDb.container.getUsername();
  process.env.DB_PASSWORD = orderDb.container.getPassword();
  process.env.DB_NAME = orderDb.container.getDatabase();
  process.env.CATALOG_GRPC_URL = catalogServer.url;
  process.env.INVENTORY_GRPC_URL = INVENTORY_GRPC_URL;

  const { AppModule: OrderAppModule } = await import('@order/app.module');
  const orderApp = await NestFactory.create(OrderAppModule, { logger: false });
  orderApp.setGlobalPrefix('api/v1');
  orderApp.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await orderApp.init();

  return { orderApp, orderDb, inventoryDb, redis, catalogServer, inventoryService };
}

export async function shutdownOrderStack(stack: OrderStack): Promise<void> {
  await stack.orderApp.close();
  await stack.inventoryService.close();
  await stack.catalogServer.stop();
  await stopOrderTestDatabase(stack.orderDb);
  await stopInventoryTestDatabase(stack.inventoryDb);
  await stack.redis.container.stop();
}
