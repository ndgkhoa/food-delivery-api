import { runJobWithTrace, stripJobTraceContext } from '@food-delivery-api/shared-observability';
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
      (job: Job<NotificationJobPayload>) =>
        runJobWithTrace(job.data, CHANNEL_QUEUE_NAMES[channel], () =>
          this.sendNotification.execute(job.data),
        ),
      { connection },
    );
    worker.on('failed', (job, err) => {
      if (!job) {
        return;
      }
      this.handleSendFailure
        // Strip the telemetry-only trace key so the DLQ parks the clean domain payload.
        .execute(stripJobTraceContext(job.data), job.attemptsMade, err.message)
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
