import type { ObjectStoragePort, StoredObjectStat } from '@media/domain/media/object-storage.port';
import { MINIO_CLIENT } from '@media/infrastructure/minio/minio.tokens';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

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
      return { sizeBytes: stat.size, contentType: stat.metaData?.['content-type'] };
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async removeObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }

  async getObject(objectKey: string, maxBytes: number): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) {
        stream.destroy();
        throw new Error(`Object ${objectKey} exceeds the ${maxBytes} byte download cap`);
      }
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

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'NotFound' || code === 'NoSuchKey';
}
