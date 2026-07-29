import { Inject, Injectable } from '@nestjs/common';
import { NotificationNotFoundError } from '@notification/domain/notification/errors';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '@notification/domain/notification/notification.repository';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannelMap,
} from '@notification/domain/notification/notification-channel.port';
import type { NotificationJobPayload } from '@notification/domain/notification/notification-queue.port';

/**
 * Worker-side use case for one BullMQ job: resolve the channel adapter for the
 * job's channel and send. A thrown error here is left to bubble up to BullMQ
 * so it drives the job's retry/backoff — this use case only records the
 * terminal SUCCESS outcome; failure bookkeeping is `HandleSendFailureHandler`,
 * run from the worker's `failed` listener (the only place `attemptsMade` is known).
 */
@Injectable()
export class SendNotificationHandler {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepository,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannelMap,
  ) {}

  async execute(payload: NotificationJobPayload): Promise<void> {
    const notification = await this.repository.findById(payload.notificationId);
    if (!notification) {
      throw new NotificationNotFoundError(payload.notificationId);
    }
    // At-least-once guard: if a prior attempt already delivered (worker crashed
    // after send but before recording it, so BullMQ re-ran the job), do not send
    // again. This does not cover a crash BETWEEN send and markSent (row still
    // PENDING) — that residual duplicate window needs a provider idempotency key,
    // added with the real email/SMS/push providers (stubs + Mailpit are safe).
    if (notification.status === 'SENT') {
      return;
    }
    await this.channels[payload.channel].send({
      recipient: payload.recipient,
      type: payload.type,
      data: payload.data,
    });
    await this.repository.markSent(payload.notificationId);
  }
}
