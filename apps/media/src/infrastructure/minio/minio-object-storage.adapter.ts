import type { ObjectStoragePort, StoredObjectStat } from '@media/domain/media/object-storage.port';
import { MINIO_CLIENT } from '@media/infrastructure/minio/minio.tokens';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

/**
 * MinIO adapter for the object-storage port. Presigned PUT/GET keep bytes off
 * the app entirely (the client transfers directly); `getObject`/`putObject` are
 * used only by the thumbnail worker. `statObject` maps a not-found into `null`
 * so a missing object is a domain-level signal rather than a thrown error.
 */
@Injectable()
export class MinioObjectStorage implements ObjectStoragePort {
  private readonly bucket: string;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    config: ConfigService,
  ) {
    this.bucket = config.getOrThrow<string>('MEDIA_BUCKET');
  }

  presignPut(objectKey: string, ttlSeconds: number): Promise<string> {
    return this.client.presignedPutObject(this.bucket, objectKey, ttlSeconds);
  }

  presignGet(objectKey: string, ttlSeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectKey, ttlSeconds);
  }

  async statObject(objectKey: string): Promise<StoredObjectStat | null> {
    try {
      const stat = await this.client.statObject(this.bucket, objectKey);
      return { sizeBytes: stat.size };
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async getObject(objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, body, body.length, {
      'Content-Type': contentType,
    });
  }
}

/**
 * MinIO surfaces a missing object as an error carrying an S3 `code`. Duck-typed
 * rather than `instanceof S3Error` because the error class is not part of the
 * package's stable public entrypoint.
 */
function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'NotFound' || code === 'NoSuchKey';
}
