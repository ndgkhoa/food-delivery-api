import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFromMaster, readFromSlave } from '@food-delivery-api/shared-persistence';
import {
  buildDataSourceOptions,
  orderOrmEntities,
} from '@order/infrastructure/persistence/typeorm-options';
import { DataSource } from 'typeorm';

/**
 * Proves the read replica's write/read split against the REAL streaming
 * standby (`postgres-replica`) — no testcontainers, since replication only
 * exists in the compose stack. Gated: needs BOTH compose profiles
 * (`--profile core --profile replica`) up, migrated, and streaming, so it
 * never runs as part of the offline unit/tsc/lint gates.
 *
 * Orchestrator run instructions:
 *   1. docker compose --env-file .env -f infra/docker-compose.yml --profile core --profile replica up -d
 *   2. Wait for both `food-delivery-postgres` and `food-delivery-postgres-replica`
 *      healthchecks to pass (`docker compose ps`).
 *   3. pnpm db:migrate   (targets the master only; the replica streams the result)
 *   4. RUN_REPLICA_E2E=true pnpm nx e2e order-e2e -- -t "read replica"
 *
 * Every OTHER order-e2e spec boots via testcontainers with no DB_REPLICA_HOST
 * set, so `buildDataSourceOptions` there keeps falling back to a single-node
 * data source (slaves === master) — this spec is the only one that talks to
 * a real second Postgres.
 */
const RUN_REPLICA_E2E = process.env.RUN_REPLICA_E2E === 'true';
const describeIfReplicaLive = RUN_REPLICA_E2E ? describe : describe.skip;

/** How long to poll the replica for a row it hasn't streamed yet before failing. */
const REPLICA_CATCHUP_TIMEOUT_MS = 10_000;
const REPLICA_CATCHUP_POLL_MS = 200;

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, REPLICA_CATCHUP_POLL_MS));
  }
  return false;
}

describeIfReplicaLive('Order read replica routing (e2e, live compose only)', () => {
  let dataSource: DataSource;
  const insertedOrderIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      ...buildDataSourceOptions({
        DB_HOST: process.env.DB_HOST ?? 'localhost',
        DB_PORT: Number(process.env.DB_PORT ?? 5432),
        DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
        DB_NAME: process.env.DB_NAME ?? 'order',
        DB_REPLICA_HOST: process.env.DB_REPLICA_HOST ?? 'localhost',
        DB_REPLICA_PORT: Number(process.env.DB_REPLICA_PORT ?? 5433),
      }),
      entities: orderOrmEntities,
      // Migrations already applied by the orchestrator's `pnpm db:migrate`
      // against the master; this DataSource only issues DML, never DDL.
      migrations: [],
    });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    if (insertedOrderIds.length > 0) {
      await readFromMaster(dataSource, (manager) =>
        manager.query('DELETE FROM "orders" WHERE id = ANY($1::uuid[])', [insertedOrderIds]),
      );
    }
    await dataSource.destroy();
  });

  it('shows the replica connected and streaming from the primary', async () => {
    const result = await readFromMaster(dataSource, (manager) =>
      manager.query<Array<{ count: string }>>(
        "SELECT count(*) AS count FROM pg_stat_replication WHERE application_name != ''",
      ),
    );

    expect(Number(result[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it('makes a just-written order visible immediately via the read-your-writes (master) path', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const orderId = randomUUID();
    insertedOrderIds.push(orderId);

    // Writes always land on master regardless of replication.defaultMode —
    // this INSERT mirrors what TypeOrmOrderRepository.insert does.
    await readFromMaster(dataSource, (manager) =>
      manager.query(
        `INSERT INTO "orders"
           ("id","tenant_id","user_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents")
         VALUES ($1,$2,$3,'PENDING',1000,0,0,0,1000)`,
        [orderId, tenantId, userId],
      ),
    );

    // The read-your-writes path (mirrors TypeOrmOrderRepository.findById via
    // the data source's master-by-default routing): must see the row with NO
    // wait, proving replica lag never affects this path.
    const rows = await readFromMaster(dataSource, (manager) =>
      manager.query<Array<{ id: string }>>('SELECT id FROM "orders" WHERE id = $1', [orderId]),
    );
    expect(rows).toHaveLength(1);
  });

  it('serves a lag-tolerant read from the replica once it catches up', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const orderId = randomUUID();
    insertedOrderIds.push(orderId);

    await readFromMaster(dataSource, (manager) =>
      manager.query(
        `INSERT INTO "orders"
           ("id","tenant_id","user_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents")
         VALUES ($1,$2,$3,'PENDING',500,0,0,0,500)`,
        [orderId, tenantId, userId],
      ),
    );

    // Mirrors TypeOrmOrderRepository.findRecentByTenant's explicit slave read.
    const caughtUp = await waitUntil(async () => {
      const rows = await readFromSlave(dataSource, (manager) =>
        manager.query<Array<{ id: string }>>('SELECT id FROM "orders" WHERE id = $1', [orderId]),
      );
      return rows.length === 1;
    }, REPLICA_CATCHUP_TIMEOUT_MS);

    expect(caughtUp).toBe(true);
  });
});
