import { runJobWithTrace } from '@food-delivery-api/shared-observability';
import { GenerateThumbnailHandler } from '@media/application/generate-thumbnail.handler';
import { THUMBNAIL_QUEUE_NAME } from '@media/domain/media/thumbnail-queue.port';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

interface ThumbnailJobData {
  mediaId: string;
}

@Injectable()
export class ThumbnailWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ThumbnailWorker.name);
  private worker?: Worker<ThumbnailJobData>;
  private connection?: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly generateThumbnail: GenerateThumbnailHandler,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.getOrThrow<string>('NODE_ENV') === 'test') {
      return;
    }
    this.connection = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.worker = new Worker<ThumbnailJobData>(
      THUMBNAIL_QUEUE_NAME,
      (job: Job<ThumbnailJobData>) =>
        runJobWithTrace(job.data, THUMBNAIL_QUEUE_NAME, () =>
          this.generateThumbnail.execute(job.data.mediaId),
        ),
      { connection: this.connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`Thumbnail job ${job?.id ?? '?'} failed: ${err.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }
}
