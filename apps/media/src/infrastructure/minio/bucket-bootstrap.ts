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
    if (await this.client.bucketExists(this.bucket)) {
      return;
    }
    try {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket "${this.bucket}"`);
    } catch (err) {
      // Two instances booting a fresh MinIO race between exists() and
      // makeBucket(); the loser gets already-owned/exists — a benign no-op.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        this.logger.log(`MinIO bucket "${this.bucket}" already created concurrently`);
        return;
      }
      throw err;
    }
  }
}
