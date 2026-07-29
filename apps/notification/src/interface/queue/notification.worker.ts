import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandleSendFailureHandler } from '@notification/application/handle-send-failure.handler';
import { SendNotificationHandler } from '@notification/application/send-notification.handler';
import { CHANNEL_NAMES, type ChannelName } from '@notification/domain/notification/notification';
import {
  CHANNEL_QUEUE_NAMES,
  type NotificationJobPayload,
} from '@notification/domain/notification/notification-queue.port';
import { type Job, Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

/**
 * One BullMQ `Worker` per channel queue (email/sms/push), each driving
 * `SendNotificationHandler` for its jobs. A send failure is left to BullMQ's
 * own retry/backoff (configured on the producer side); `HandleSendFailureHandler`
 * runs from the `failed` listener — the only place `attemptsMade` is known —
 * to record FAILED (retryable) or DEAD + notify-dlq (exhausted). Skipped
 * under NODE_ENV=test so unit suites need no live Redis.
 */
@Injectable()
export class NotificationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationWorker.name);
  private readonly workers: Worker<NotificationJobPayload>[] = [];
  private readonly connections: Redis[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly sendNotification: SendNotificationHandler,
    private readonly handleSendFailure: HandleSendFailureHandler,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.getOrThrow<string>('NODE_ENV') === 'test') {
      return;
    }
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
    for (const channel of CHANNEL_NAMES) {
      this.startWorker(channel, redisUrl);
    }
  }

  private startWorker(channel: ChannelName, redisUrl: string): void {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker<NotificationJobPayload>(
      CHANNEL_QUEUE_NAMES[channel],
      (job: Job<NotificationJobPayload>) => this.sendNotification.execute(job.data),
      { connection },
    );
    worker.on('failed', (job, err) => {
      if (!job) {
        return;
      }
      this.handleSendFailure
        .execute(job.data, job.attemptsMade, err.message)
        .catch((handlerError: unknown) =>
          this.logger.error(`Failed to record ${channel} send failure: ${handlerError}`),
        );
    });
    this.workers.push(worker);
    this.connections.push(connection);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all(
      this.connections.map((connection) =>
        connection.status !== 'end' ? connection.quit() : undefined,
      ),
    );
  }
}
