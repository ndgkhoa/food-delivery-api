import type { ChannelName } from '@notification/domain/notification/notification';

/** BullMQ job payload — everything the per-channel worker needs to send + report back. */
export interface NotificationJobPayload {
  notificationId: string;
  channel: ChannelName;
  type: string;
  recipient: string;
  tenantId: string;
  data: Record<string, unknown>;
}

/** BullMQ queue name per channel — shared by the producer adapter and the interface worker. */
export const CHANNEL_QUEUE_NAMES: Record<ChannelName, string> = {
  email: 'notify-email',
  sms: 'notify-sms',
  push: 'notify-push',
};

/** Parked queue exhausted sends land in — created paused, never consumed, purely observable. */
export const NOTIFY_DLQ_QUEUE_NAME = 'notify-dlq';

export interface NotificationQueuePort {
  enqueue(channel: ChannelName, payload: NotificationJobPayload): Promise<void>;
}

export const NOTIFICATION_QUEUE = Symbol('NotificationQueuePort');

export interface NotificationDlqPort {
  park(payload: NotificationJobPayload & { error: string }): Promise<void>;
}

export const NOTIFICATION_DLQ = Symbol('NotificationDlqPort');
