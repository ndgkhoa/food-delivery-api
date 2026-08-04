import type { ChannelName } from '@notification/domain/notification/notification';

export interface NotificationJobPayload {
  notificationId: string;
  channel: ChannelName;
  type: string;
  recipient: string;
  tenantId: string;
  data: Record<string, unknown>;
}

export const CHANNEL_QUEUE_NAMES: Record<ChannelName, string> = {
  email: 'notify-email',
  sms: 'notify-sms',
  push: 'notify-push',
};

export const NOTIFY_DLQ_QUEUE_NAME = 'notify-dlq';

export interface NotificationQueuePort {
  enqueue(channel: ChannelName, payload: NotificationJobPayload): Promise<void>;
}

export const NOTIFICATION_QUEUE = Symbol('NotificationQueuePort');

export interface NotificationDlqPort {
  park(payload: NotificationJobPayload & { error: string }): Promise<void>;
}

export const NOTIFICATION_DLQ = Symbol('NotificationDlqPort');
