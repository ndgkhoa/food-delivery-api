import {
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import { createKafkaClient, KafkaTopicAdmin } from '@food-delivery-api/shared-messaging';
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
import { KafkaContainer, type StartedKafkaContainer } from '@testcontainers/kafka';
import { type FakeCatalogGrpcServer, startFakeCatalogGrpcServer } from './fake-catalog-grpc-server';
import { type StartedRedis, startRedisContainer } from './start-redis-container';

const INVENTORY_GRPC_URL = '127.0.0.1:50652';

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.9.1';
const KAFKA_EXTERNAL_PORT = 9093;

export interface OrderStack {
  orderApp: INestApplication;
  orderDb: OrderTestDatabase;
  inventoryDb: InventoryTestDatabase;
  redis: StartedRedis;
  kafka: StartedKafkaContainer;
  catalogServer: FakeCatalogGrpcServer;
  inventoryService: INestMicroservice;
}

export async function bootOrderStack(): Promise<OrderStack> {
  const orderDb = await startOrderTestDatabase();
  const inventoryDb = await startInventoryTestDatabase();
  const redis = await startRedisContainer();
  const kafka = await new KafkaContainer(KAFKA_IMAGE).start();
  const catalogServer = await startFakeCatalogGrpcServer();

  const brokers = `${kafka.getHost()}:${kafka.getMappedPort(KAFKA_EXTERNAL_PORT)}`;

  const warmupClient = createKafkaClient({ clientId: 'order-e2e-warmup', brokers: [brokers] });
  await new KafkaTopicAdmin(warmupClient).ensureTopics([
    { topic: 'inventory.commands' },
    { topic: 'inventory.replies' },
    { topic: 'payment.commands' },
    { topic: 'payment.replies' },
  ]);

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.KAFKA_BROKERS = brokers;

  process.env.DB_HOST = inventoryDb.container.getHost();
  process.env.DB_PORT = String(inventoryDb.container.getPort());
  process.env.DB_USERNAME = inventoryDb.container.getUsername();
  process.env.DB_PASSWORD = inventoryDb.container.getPassword();
  process.env.DB_NAME = inventoryDb.container.getDatabase();
  process.env.REDIS_URL = redis.url;
  process.env.INVENTORY_GRPC_URL = INVENTORY_GRPC_URL;
  process.env.KAFKA_CLIENT_ID = 'inventory-e2e';

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

  process.env.DB_HOST = orderDb.container.getHost();
  process.env.DB_PORT = String(orderDb.container.getPort());
  process.env.DB_USERNAME = orderDb.container.getUsername();
  process.env.DB_PASSWORD = orderDb.container.getPassword();
  process.env.DB_NAME = orderDb.container.getDatabase();
  process.env.CATALOG_GRPC_URL = catalogServer.url;
  process.env.INVENTORY_GRPC_URL = INVENTORY_GRPC_URL;
  process.env.KAFKA_CLIENT_ID = 'order-e2e';

  const { AppModule: OrderAppModule } = await import('@order/app.module');
  const orderApp = await NestFactory.create(OrderAppModule, { logger: false });
  orderApp.setGlobalPrefix('api/v1');
  orderApp.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await orderApp.listen(0);

  return { orderApp, orderDb, inventoryDb, redis, kafka, catalogServer, inventoryService };
}

export async function shutdownOrderStack(stack: OrderStack): Promise<void> {
  await stack.orderApp.close();
  await stack.inventoryService.close();
  await stack.catalogServer.stop();
  await stopOrderTestDatabase(stack.orderDb);
  await stopInventoryTestDatabase(stack.inventoryDb);
  await stack.redis.container.stop();
  await stack.kafka.stop();
}
