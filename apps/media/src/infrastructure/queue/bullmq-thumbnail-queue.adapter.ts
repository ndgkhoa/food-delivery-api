import {
  THUMBNAIL_QUEUE_NAME,
  type ThumbnailQueuePort,
} from '@media/domain/media/thumbnail-queue.port';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

/** Retry policy for a thumbnail job before it is left failed (row stays UPLOADED). */
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2_000;

/**
 * BullMQ producer for the thumbnail queue. The job id is the media id, so
 * re-completing the same upload never enqueues a duplicate while a job is
 * pending/active. On exhausted retries the job is kept (`removeOnFail: false`)
 * for inspection; it is NOT marked complete, so the row never flips to a false
 * READY. Its own Redis connection is drained on shutdown.
 */
@Injectable()
export class BullMqThumbnailQueue implements ThumbnailQueuePort, OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(config: ConfigService) {
    this.connection = new IORedis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(THUMBNAIL_QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(mediaId: string): Promise<void> {
    await this.queue.add(
      'thumbnail',
      { mediaId },
      {
        jobId: mediaId,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    if (this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }
}
