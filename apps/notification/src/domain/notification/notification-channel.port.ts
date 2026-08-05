import type { ChannelName } from '@notification/domain/notification/notification';

export interface NotificationMessage {
  recipient: string;
  type: string;
  data: Record<string, unknown>;
}

export interface NotificationChannel {
  send(message: NotificationMessage): Promise<void>;
}

export const EMAIL_CHANNEL = Symbol('EmailNotificationChannel');
export const SMS_CHANNEL = Symbol('SmsNotificationChannel');
export const PUSH_CHANNEL = Symbol('PushNotificationChannel');

export type NotificationChannelMap = Record<ChannelName, NotificationChannel>;

export const NOTIFICATION_CHANNELS = Symbol('NotificationChannelMap');
