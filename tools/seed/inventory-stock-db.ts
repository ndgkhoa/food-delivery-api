import { Client } from 'pg';
import type { SeedConfig } from './seed-config';

/**
 * Inventory stock has no HTTP endpoint (see `apps/inventory/src/interface`),
 * so the seeder writes/deletes rows directly in the inventory service's own
 * Postgres database — the ONE deliberate carve-out from the "API-driven"
 * approach. Table shape mirrors `StockOrmEntity`: composite primary key
 * `(tenant_id, item_id)`, integer `available`.
 */
export async function withInventoryDb<T>(
  config: SeedConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUsername,
    password: config.dbPassword,
    database: config.inventoryDbName,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Upsert on the composite PK so re-running `up` is idempotent. */
export async function upsertStock(
  client: Client,
  tenantId: string,
  itemId: string,
  available: number,
): Promise<void> {
  await client.query(
    `INSERT INTO stock (tenant_id, item_id, available)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, item_id) DO UPDATE SET available = EXCLUDED.available, updated_at = now()`,
    [tenantId, itemId, available],
  );
}

/** Scoped delete of a single (tenant_id, item_id) row — never a table-wide truncate. */
export async function deleteStock(client: Client, tenantId: string, itemId: string): Promise<void> {
  await client.query('DELETE FROM stock WHERE tenant_id = $1 AND item_id = $2', [tenantId, itemId]);
}
