import { injectJobTraceContext } from '@food-delivery-api/shared-observability';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelName } from '@notification/domain/notification/notification';
import {
  CHANNEL_QUEUE_NAMES,
  type NotificationJobPayload,
  type NotificationQueuePort,
} from '@notification/domain/notification/notification-queue.port';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

/**
 * BullMQ producer for the three per-channel queues. `jobId = notificationId`
 * dedupes: a notification row can enqueue its job at most once while it is
 * pending/active (BullMQ ignores a duplicate jobId already in the queue).
 * Attempts + backoff are env-driven (`NOTIFY_MAX_ATTEMPTS`/`NOTIFY_BACKOFF_MS`)
 * — the same env `HandleSendFailureHandler` reads for its exhaustion check.
 */
@Injectable()
export class BullMqNotificationQueue implements NotificationQueuePort, OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queues: Record<ChannelName, Queue<NotificationJobPayload>>;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(config: ConfigService) {
    this.connection = new IORedis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.maxAttempts = config.getOrThrow<number>('NOTIFY_MAX_ATTEMPTS');
    this.backoffMs = config.getOrThrow<number>('NOTIFY_BACKOFF_MS');
    this.queues = {
      email: new Queue(CHANNEL_QUEUE_NAMES.email, { connection: this.connection }),
      sms: new Queue(CHANNEL_QUEUE_NAMES.sms, { connection: this.connection }),
      push: new Queue(CHANNEL_QUEUE_NAMES.push, { connection: this.connection }),
    };
  }

  async enqueue(channel: ChannelName, payload: NotificationJobPayload): Promise<void> {
    await this.queues[channel].add(`notify-${channel}`, injectJobTraceContext(payload), {
      jobId: payload.notificationId,
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
    if (this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }
}
