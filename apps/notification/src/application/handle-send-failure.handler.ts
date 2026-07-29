import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '@notification/domain/notification/notification.repository';
import {
  NOTIFICATION_DLQ,
  type NotificationDlqPort,
  type NotificationJobPayload,
} from '@notification/domain/notification/notification-queue.port';

/**
 * Records a BullMQ job failure against its `notifications` row. Below the
 * attempt ceiling the row is marked FAILED (retryable — BullMQ still owns the
 * retry/backoff); AT or above it the outcome is terminal: the row is marked
 * DEAD AND the payload is parked on `notify-dlq`, so an exhausted send is
 * never silently lost, only ever observable.
 */
@Injectable()
export class HandleSendFailureHandler {
  private readonly logger = new Logger(HandleSendFailureHandler.name);
  private readonly maxAttempts: number;

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepository,
    @Inject(NOTIFICATION_DLQ) private readonly dlq: NotificationDlqPort,
    config: ConfigService,
  ) {
    this.maxAttempts = config.getOrThrow<number>('NOTIFY_MAX_ATTEMPTS');
  }

  async execute(
    payload: NotificationJobPayload,
    attemptsMade: number,
    error: string,
  ): Promise<void> {
    if (attemptsMade < this.maxAttempts) {
      await this.repository.markFailed(payload.notificationId, attemptsMade, error);
      return;
    }
    this.logger.error(
      `Notification ${payload.notificationId} (${payload.channel}) exhausted ${attemptsMade} ` +
        `attempts; parking to notify-dlq: ${error}`,
    );
    // Park the replay payload FIRST, then flip the row terminal — so we can never
    // record a DEAD row whose payload was lost. If parking throws it bubbles to
    // BullMQ (job stays in the failed set, still observable) rather than leaving a
    // DEAD-without-DLQ hole.
    await this.dlq.park({ ...payload, error });
    await this.repository.markDead(payload.notificationId, attemptsMade, error);
  }
}
