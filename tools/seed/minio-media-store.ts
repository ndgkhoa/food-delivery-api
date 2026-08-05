import { Client } from 'minio';
import type { SeedConfig } from './seed-config';

export function createMinioClient(config: SeedConfig): Client {
  return new Client({
    endPoint: config.minioEndpoint,
    port: config.minioPort,
    useSSL: config.minioUseSsl,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  });
}

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
