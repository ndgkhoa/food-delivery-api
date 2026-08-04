import { MINIO_CLIENT } from '@media/infrastructure/minio/minio.tokens';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class BucketBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(BucketBootstrap.name);
  private readonly bucket: string;
  private readonly enabled: boolean;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    config: ConfigService,
  ) {
    this.bucket = config.getOrThrow<string>('MEDIA_BUCKET');
    this.enabled = config.getOrThrow<string>('NODE_ENV') !== 'test';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    if (await this.client.bucketExists(this.bucket)) {
      return;
    }
    try {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket "${this.bucket}"`);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        this.logger.log(`MinIO bucket "${this.bucket}" already created concurrently`);
        return;
      }
      throw err;
    }
  }
}
