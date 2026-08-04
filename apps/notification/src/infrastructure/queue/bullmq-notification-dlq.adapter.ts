import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFY_DLQ_QUEUE_NAME,
  type NotificationDlqPort,
  type NotificationJobPayload,
} from '@notification/domain/notification/notification-queue.port';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

@Injectable()
export class BullMqNotificationDlq implements NotificationDlqPort, OnApplicationShutdown {
  private readonly logger = new Logger(BullMqNotificationDlq.name);
  private readonly connection: Redis;
  private readonly queue: Queue<NotificationJobPayload & { error: string }>;
  private readonly paused: Promise<void>;

  constructor(config: ConfigService) {
    this.connection = new IORedis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(NOTIFY_DLQ_QUEUE_NAME, { connection: this.connection });
    this.paused = this.queue.pause().catch((error: unknown) => {
      this.logger.error(`Failed to pause ${NOTIFY_DLQ_QUEUE_NAME}: ${error}`);
    });
  }

  async park(payload: NotificationJobPayload & { error: string }): Promise<void> {
    await this.paused;
    await this.queue.add('parked', payload, { removeOnComplete: false, removeOnFail: false });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    if (this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }
}
