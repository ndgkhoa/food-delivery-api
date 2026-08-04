import { Client } from 'minio';
import type { SeedConfig } from './seed-config';

/**
 * `apps/media/src/interface/http/media.controller.ts` exposes only
 * create/complete/get — no `DELETE` route — so teardown removes the demo
 * objects directly from MinIO instead, the same "own the storage, bypass the
 * missing HTTP surface" carve-out already used for inventory stock. Client
 * construction mirrors `apps/media/src/infrastructure/minio/minio-client.module.ts`.
 * The `media_objects` Postgres row is intentionally left behind (media has
 * no seeder DB carve-out equivalent to inventory's) — a re-run's
 * `GET /media/:id` would still resolve the row but the object bytes are
 * gone; acceptable for demo data.
 */
export function createMinioClient(config: SeedConfig): Client {
  return new Client({
    endPoint: config.minioEndpoint,
    port: config.minioPort,
    useSSL: config.minioUseSsl,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  });
}

/** 404-equivalent ("no such key") is swallowed as success — re-running teardown on an already-removed object is a no-op. */
export async function removeMediaObject(
  client: Client,
  bucket: string,
  objectKey: string,
): Promise<void> {
  try {
    await client.removeObject(bucket, objectKey);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'NotFound' || code === 'NoSuchKey') return;
    throw error;
  }
}
