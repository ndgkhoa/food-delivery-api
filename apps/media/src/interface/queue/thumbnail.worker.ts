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

/**
 * Background consumer of the thumbnail queue: it drives the generate-thumbnail
 * use case for each job. A failed job (all attempts exhausted) leaves the row at
 * UPLOADED — never a false READY — and is logged for operators; BullMQ retains
 * it. Its own Redis connection + worker loop start on boot and drain on
 * shutdown. Skipped under NODE_ENV=test so unit suites need no live Redis.
 */
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
      (job: Job<ThumbnailJobData>) => this.generateThumbnail.execute(job.data.mediaId),
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
