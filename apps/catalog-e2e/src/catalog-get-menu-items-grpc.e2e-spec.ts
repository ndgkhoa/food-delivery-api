import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  type CatalogTestDatabase,
  startCatalogTestDatabase,
  stopCatalogTestDatabase,
  truncateCatalogTables,
} from '@catalog/testing/catalog-test-database';
import {
  CATALOG_GRPC_PACKAGE,
  catalogProtoPath,
  type GetMenuItemsRequest,
  GRPC_TENANT_ID_METADATA,
  type MenuItemsResponse,
  PROTO_LOADER_OPTIONS,
} from '@food-delivery-api/shared-contracts';
import {
  type ChannelCredentials,
  credentials,
  loadPackageDefinition,
  Metadata,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { INestApplication } from '@nestjs/common';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';

const GRPC_URL = '127.0.0.1:50552';

interface CatalogRawClient {
  GetMenuItems(
    request: GetMenuItemsRequest,
    metadata: Metadata,
    callback: (error: Error | null, response: MenuItemsResponse) => void,
  ): void;
  close(): void;
}

type CatalogClientCtor = new (address: string, creds: ChannelCredentials) => CatalogRawClient;

function buildClient(): CatalogRawClient {
  const packageDefinition = loadSync(catalogProtoPath(), PROTO_LOADER_OPTIONS);
  const proto = loadPackageDefinition(packageDefinition) as unknown as {
    catalog: { CatalogService: CatalogClientCtor };
  };
  return new proto.catalog.CatalogService(GRPC_URL, credentials.createInsecure());
}

/**
 * Proves the catalog hybrid app's gRPC surface: a live catalog (HTTP + gRPC in
 * one process, real migrated Postgres) resolves menu items over a real gRPC
 * channel, tenant-scoped from metadata — and never leaks another tenant's items.
 *
 *   pnpm nx e2e catalog-e2e
 */
describe('Catalog GetMenuItems gRPC (e2e)', () => {
  let app: INestApplication;
  let db: CatalogTestDatabase;
  let client: CatalogRawClient;

  const tenantId = '33333333-3333-4333-8333-333333333333';
  const otherTenantId = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    db = await startCatalogTestDatabase();

    process.env.DB_HOST = db.container.getHost();
    process.env.DB_PORT = String(db.container.getPort());
    process.env.DB_USERNAME = db.container.getUsername();
    process.env.DB_PASSWORD = db.container.getPassword();
    process.env.DB_NAME = db.container.getDatabase();
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'fatal';

    const { AppModule } = await import('@catalog/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: CATALOG_GRPC_PACKAGE,
        protoPath: catalogProtoPath(),
        url: GRPC_URL,
        loader: PROTO_LOADER_OPTIONS,
      },
    });
    await app.startAllMicroservices();
    await app.init();
    client = buildClient();
  }, 120000);

  afterAll(async () => {
    client?.close();
    await app?.close();
    await stopCatalogTestDatabase(db);
  });

  afterEach(async () => {
    await truncateCatalogTables(db.dataSource);
  });

  async function seedMenuItem(itemTenantId: string): Promise<string> {
    const restaurantId = randomUUID();
    const itemId = randomUUID();
    await db.dataSource.query(
      'INSERT INTO "restaurants" ("id", "tenant_id", "name") VALUES ($1, $2, $3)',
      [restaurantId, itemTenantId, 'Pho 24'],
    );
    await db.dataSource.query(
      'INSERT INTO "menu_items" ("id", "tenant_id", "restaurant_id", "name", "price_cents") VALUES ($1, $2, $3, $4, $5)',
      [itemId, itemTenantId, restaurantId, 'Pho', 1299],
    );
    return itemId;
  }

  function getMenuItems(ids: string[], callerTenantId: string): Promise<MenuItemsResponse> {
    const metadata = new Metadata();
    metadata.set(GRPC_TENANT_ID_METADATA, callerTenantId);
    return new Promise((resolve, reject) => {
      client.GetMenuItems({ tenantId: callerTenantId, ids }, metadata, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  it('returns the requested menu items for the caller tenant', async () => {
    const itemId = await seedMenuItem(tenantId);

    const response = await getMenuItems([itemId], tenantId);

    expect(response.items).toHaveLength(1);
    expect(response.items[0].id).toBe(itemId);
    expect(response.items[0].priceCents).toBe(1299);
  });

  it('does not leak items belonging to another tenant', async () => {
    const itemId = await seedMenuItem(otherTenantId);

    const response = await getMenuItems([itemId], tenantId);

    expect(response.items).toHaveLength(0);
  });
});
