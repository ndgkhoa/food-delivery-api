import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ReserveStockHandler } from '@inventory/application/reservation/commands/reserve-stock.handler';
import {
  type InventoryTestDatabase,
  startInventoryTestDatabase,
  stopInventoryTestDatabase,
  truncateInventoryTables,
} from '@inventory/testing/inventory-test-database';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type StartedRedis, startRedisContainer } from './support/start-redis-container';

/**
 * The no-oversell concurrency PROOF against real Postgres + real Redis. Fires
 * many concurrent single-unit reserves at one item with limited stock: the
 * Redis per-item lock + DB transaction + domain re-check must let through
 * exactly `available` winners and reject the rest, leaving available at 0.
 *
 * This is the load-bearing correctness test for the slice — run it with:
 *   pnpm nx e2e inventory-e2e
 */
describe('Inventory reserve — no-oversell under concurrency (e2e)', () => {
  let app: INestApplication;
  let db: InventoryTestDatabase;
  let redis: StartedRedis;
  let reserveStock: ReserveStockHandler;

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

    // Import AFTER env is set — ConfigModule validates/bakes at module-import time.
    const { AppModule } = await import('@inventory/app.module');
    const { ReserveStockHandler } = await import(
      '@inventory/application/reservation/commands/reserve-stock.handler'
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    reserveStock = app.get(ReserveStockHandler);
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await stopInventoryTestDatabase(db);
    await redis?.container.stop();
  });

  afterEach(async () => {
    await truncateInventoryTables(db.dataSource);
  });

  it('50 concurrent reserves of 1 unit against stock=10 → exactly 10 succeed, 40 fail, available=0', async () => {
    const tenantId = randomUUID();
    const itemId = randomUUID();
    await db.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, 10],
    );

    // 50 distinct orders (distinct orderIds so idempotency never collapses them),
    // each reserving a single unit, all fired concurrently.
    const attempts = Array.from({ length: 50 }, () =>
      reserveStock.execute({
        tenantId,
        orderId: randomUUID(),
        items: [{ itemId, qty: 1 }],
      }),
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    expect(succeeded).toBe(10);
    expect(failed).toBe(40);

    const rows = await db.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(rows[0].available)).toBe(0);

    // Exactly 10 active reservations were written — one per winner, zero oversell.
    const reservations = await db.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM "reservations" WHERE "tenant_id" = $1 AND "status" = $2',
      [tenantId, 'ACTIVE'],
    );
    expect(reservations[0].count).toBe(10);
  });

  it('reserve then release returns the stock and lets it be reserved again', async () => {
    const tenantId = randomUUID();
    const itemId = randomUUID();
    const orderId = randomUUID();
    await db.dataSource.query(
      'INSERT INTO "stock" ("tenant_id", "item_id", "available") VALUES ($1, $2, $3)',
      [tenantId, itemId, 3],
    );

    const { ReleaseStockHandler } = await import(
      '@inventory/application/reservation/commands/release-stock.handler'
    );
    const releaseStock = app.get(ReleaseStockHandler);

    const reserved = await reserveStock.execute({ tenantId, orderId, items: [{ itemId, qty: 3 }] });
    expect(reserved.ok).toBe(true);

    await releaseStock.execute({ tenantId, orderId });

    const rows = await db.dataSource.query(
      'SELECT "available" FROM "stock" WHERE "tenant_id" = $1 AND "item_id" = $2',
      [tenantId, itemId],
    );
    expect(Number(rows[0].available)).toBe(3);
  });
});
