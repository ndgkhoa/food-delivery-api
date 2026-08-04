import { Module } from '@nestjs/common';
import {
  NOTIFICATION_DLQ,
  NOTIFICATION_QUEUE,
} from '@notification/domain/notification/notification-queue.port';
import { BullMqNotificationDlq } from '@notification/infrastructure/queue/bullmq-notification-dlq.adapter';
import { BullMqNotificationQueue } from '@notification/infrastructure/queue/bullmq-notification-queue.adapter';

@Module({
  providers: [
    { provide: NOTIFICATION_QUEUE, useClass: BullMqNotificationQueue },
    { provide: NOTIFICATION_DLQ, useClass: BullMqNotificationDlq },
  ],
  exports: [NOTIFICATION_QUEUE, NOTIFICATION_DLQ],
})
export class NotificationQueueModule {}
