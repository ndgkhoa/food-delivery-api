import { MINIO_CLIENT } from '@media/infrastructure/minio/minio.tokens';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

/**
 * Creates the media bucket on boot if it does not exist, so a fresh MinIO
 * requires no manual `mc mb`. Skipped under NODE_ENV=test so unit suites never
 * reach for a live MinIO.
 */
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
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket "${this.bucket}"`);
    }
  }
}
