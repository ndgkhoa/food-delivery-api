import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  GRPC_TENANT_ID_METADATA,
  INVENTORY_GRPC_PACKAGE,
  inventoryProtoPath,
  PROTO_LOADER_OPTIONS,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReserveRequest,
  type ReserveResponse,
} from '@food-delivery-api/shared-contracts';
import {
  type ChannelCredentials,
  credentials,
  loadPackageDefinition,
  Metadata,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  type InventoryTestDatabase,
  startInventoryTestDatabase,
  stopInventoryTestDatabase,
  truncateInventoryTables,
} from '@inventory/testing/inventory-test-database';
import type { INestMicroservice } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { type StartedRedis, startRedisContainer } from './support/start-redis-container';

const GRPC_URL = '127.0.0.1:50551';

interface InventoryRawClient {
  Reserve(
    request: ReserveRequest,
    metadata: Metadata,
    callback: (error: Error | null, response: ReserveResponse) => void,
  ): void;
  Release(
    request: ReleaseRequest,
    metadata: Metadata,
    callback: (error: Error | null, response: ReleaseResponse) => void,
  ): void;
  close(): void;
}

type InventoryClientCtor = new (address: string, creds: ChannelCredentials) => InventoryRawClient;

function buildClient(): InventoryRawClient {
  const packageDefinition = loadSync(inventoryProtoPath(), PROTO_LOADER_OPTIONS);
  const proto = loadPackageDefinition(packageDefinition) as unknown as {
    inventory: { InventoryService: InventoryClientCtor };
  };
  return new proto.inventory.InventoryService(GRPC_URL, credentials.createInsecure());
}

function tenantMetadata(tenantId: string): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_TENANT_ID_METADATA, tenantId);
  return metadata;
}

describe('Inventory gRPC Reserve/Release (e2e)', () => {
  let service: INestMicroservice;
  let db: InventoryTestDatabase;
  let redis: StartedRedis;
  let client: InventoryRawClient;

  beforeAll(async () => {
    db = await startInventoryTestDatabase();
    redis = await startRedisContainer();

    process.env.DB_HOST = db.container.getHost();
    process.env.DB_PORT = String(db.container.getPort());
    process.env.DB_USERNAME = db.container.getUsername();
    process.env.DB_PASSWORD = db.container.getPassword();
    process.env.DB_NAME = db.container.getDatabase();
    process.env.REDIS_URL = redis.url;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'fatal';

    const { AppModule } = await import('@inventory/app.module');
    service = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
      transport: Transport.GRPC,
      options: {
        package: INVENTORY_GRPC_PACKAGE,
        protoPath: inventoryProtoPath(),
        url: GRPC_URL,
        loader: PROTO_LOADER_OPTIONS,
      },
      bufferLogs: true,
    });
    await service.listen();
    client = buildClient();
  }, 120000);

  afterAll(async () => {
    client?.close();
    await service?.close();
    await stopInventoryTestDatabase(db);
    await redis?.container.stop();
  });

  afterEach(async () => {
    await truncateInventoryTables(db.dataSource);
  });

  function reserve(request: ReserveRequest, tenantId: string): Promise<ReserveResponse> {
    return new Promise((resolve, reject) => {
      client.Reserve(request, tenantMetadata(tenantId), (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  it('reserves over a real gRPC channel and decrements stock', async () => {
    const tenantId = randomUUID();
    const itemId = randomUUID();
    const orderId = randomUUID();
    await db.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, 5],
    );

    const response = await reserve({ tenantId, orderId, items: [{ itemId, qty: 2 }] }, tenantId);

    expect(response.ok).toBe(true);
    expect(response.reservationIds).toHaveLength(1);

    const rows = await db.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(rows[0].available)).toBe(3);
  });

  it('rejects a call with no tenant metadata (fails closed)', async () => {
    const itemId = randomUUID();
    await expect(
      new Promise<ReserveResponse>((resolve, reject) => {
        client.Reserve(
          { tenantId: '', orderId: randomUUID(), items: [{ itemId, qty: 1 }] },
          new Metadata(),
          (error, response) => (error ? reject(error) : resolve(response)),
        );
      }),
    ).rejects.toBeDefined();
  });
});
