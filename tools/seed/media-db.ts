import { Client } from 'pg';
import type { SeedConfig } from './seed-config';

/**
 * Media exposes no `DELETE /media/:id` route, so `seed:down` removes the object
 * bytes from MinIO AND deletes the metadata row directly in the media service's
 * own Postgres database — a teardown carve-out mirroring the inventory-stock
 * one. Table shape mirrors `MediaObjectOrmEntity`: primary key `id`, one row per
 * uploaded object.
 */
export async function withMediaDb<T>(
  config: SeedConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUsername,
    password: config.dbPassword,
    database: config.mediaDbName,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Scoped delete of a single seeded media row by its id — never a table-wide truncate. */
export async function deleteMediaRow(client: Client, id: string): Promise<void> {
  await client.query('DELETE FROM media_objects WHERE id = $1', [id]);
}
