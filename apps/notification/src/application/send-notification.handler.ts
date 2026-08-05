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
