import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  type OrderTestDatabase,
  startOrderTestDatabase,
  stopOrderTestDatabase,
} from '@order/testing/order-test-database';

/**
 * Verifies the payoff of partitioning `orders` by month: a `created_at`-bounded
 * query only touches the covering partition, not every partition (and not the
 * DEFAULT). Boots just the order Postgres (no Kafka/gRPC/inventory — this is a
 * storage-layer check, not a saga one), seeds rows across two different
 * months, then asserts the query plan's touched relations.
 *
 *   pnpm nx e2e order-e2e
 */
describe('Order partition pruning (e2e)', () => {
  let db: OrderTestDatabase;

  beforeAll(async () => {
    db = await startOrderTestDatabase();
  }, 120000);

  afterAll(async () => {
    await stopOrderTestDatabase(db);
  });

  it('prunes a created_at-bounded scan to only the covering monthly partition', async () => {
    const tenantId = randomUUID();

    // The migration only pre-creates partitions for the current + next
    // month when `orders` is empty at migration time (as it is here) — so
    // this test seeds THIS month and NEXT month rather than hardcoded
    // calendar months, to always land on partitions the migration actually
    // created.
    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const thisMonthTag = yyyyMm(thisMonthStart);
    const nextMonthTag = yyyyMm(nextMonthStart);

    // Two rows a month apart — one falls inside the query's bounded range,
    // one deliberately outside it, so a plan that failed to prune would
    // surface as scanning both partitions instead of one.
    await insertOrder(db, { tenantId, createdAt: addDays(thisMonthStart, 5).toISOString() });
    await insertOrder(db, { tenantId, createdAt: addDays(nextMonthStart, 5).toISOString() });

    const plan = await db.dataSource.query(
      `EXPLAIN (FORMAT TEXT)
       SELECT * FROM "orders"
       WHERE "created_at" >= $1 AND "created_at" < $2`,
      [thisMonthStart.toISOString(), nextMonthStart.toISOString()],
    );
    const planText = plan.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']).join('\n');

    // This month's partition is scanned...
    expect(planText).toMatch(new RegExp(`orders_p${thisMonthTag}`));
    // ...but next month's partition and the DEFAULT partition are pruned
    // away — the planner never even mentions them in the plan.
    expect(planText).not.toMatch(new RegExp(`orders_p${nextMonthTag}`));
    expect(planText).not.toMatch(/orders_default/);
  });
});

function yyyyMm(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

async function insertOrder(
  db: OrderTestDatabase,
  { tenantId, createdAt }: { tenantId: string; createdAt: string },
): Promise<void> {
  await db.dataSource.query(
    `INSERT INTO "orders"
       ("id","tenant_id","user_id","status","subtotal_cents","delivery_fee_cents","vat_cents","discount_cents","total_cents","created_at")
     VALUES ($1,$2,$3,'PENDING',1000,0,0,0,1000,$4)`,
    [randomUUID(), tenantId, randomUUID(), createdAt],
  );
}
