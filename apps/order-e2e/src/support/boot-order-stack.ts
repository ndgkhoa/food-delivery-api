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

/** Fixed loopback port for the in-process inventory microservice this stack boots. */
const INVENTORY_GRPC_URL = '127.0.0.1:50652';

// The @testcontainers/kafka module wires advertised listeners for the Confluent
// cp-kafka image family; it exposes the plaintext client listener on 9093. A
// real broker is needed only so each app's MessagingModule producer connects on
// boot — the saga's consumers/relay stay OFF under NODE_ENV=test, so this stack
// proves the async CONTRACT (PENDING + saga STARTED + a ReserveStock outbox row)
// without exercising the live cross-service saga (that is the compose e2e).
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
  const kafka = await new KafkaContainer(KAFKA_IMAGE).start();
  const catalogServer = await startFakeCatalogGrpcServer();

  const brokers = `${kafka.getHost()}:${kafka.getMappedPort(KAFKA_EXTERNAL_PORT)}`;

  // Warm up the broker before any app's idempotent producer connects. A
  // successful admin round-trip is a readiness barrier: `@testcontainers/kafka`
  // resolves start() once the port is open, but the broker may still be loading
  // its coordinators — and the idempotent producer's PID acquisition against a
  // half-ready broker surfaced as an unhandled "read ECONNRESET" that failed the
  // test. Pre-creating the saga topics here also stops the producers/consumers
  // from racing topic auto-creation.
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

  // Phase 1: boot inventory against its own Postgres + Redis.
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

  // Phase 2: boot order against its own Postgres + the two gRPC endpoints above.
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
  // listen (not just init) so the HTTP server is already bound before the tests
  // fire concurrent supertest requests. supertest calls listen(0) itself per
  // request against a non-listening server; ~100 of those racing to bind the
  // same server reset connections ("read ECONNRESET"). Binding once here removes
  // the race — requests reuse the one listening server.
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
