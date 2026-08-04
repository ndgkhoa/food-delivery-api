import { Client } from 'pg';
import type { SeedConfig } from './seed-config';

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

export async function deleteMediaRow(client: Client, id: string): Promise<void> {
  await client.query('DELETE FROM media_objects WHERE id = $1', [id]);
}
