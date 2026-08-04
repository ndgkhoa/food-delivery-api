import { injectJobTraceContext } from '@food-delivery-api/shared-observability';
import {
  THUMBNAIL_QUEUE_NAME,
  type ThumbnailQueuePort,
} from '@media/domain/media/thumbnail-queue.port';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2_000;

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
    await this.queue.add('thumbnail', injectJobTraceContext({ mediaId }), {
      jobId: mediaId,
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    if (this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }
}
