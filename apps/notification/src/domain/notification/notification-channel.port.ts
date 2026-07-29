import type { ChannelName } from '@notification/domain/notification/notification';

/** The message a channel adapter actually sends — resolved recipient + rendered content inputs. */
export interface NotificationMessage {
  recipient: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Port every channel adapter implements. Kept to a single `send` so the
 * Mailpit/log-stub adapters today, and a real Twilio/FCM adapter later, are
 * interchangeable with no consumer/worker change.
 */
export interface NotificationChannel {
  send(message: NotificationMessage): Promise<void>;
}

export const EMAIL_CHANNEL = Symbol('EmailNotificationChannel');
export const SMS_CHANNEL = Symbol('SmsNotificationChannel');
export const PUSH_CHANNEL = Symbol('PushNotificationChannel');

/** Channel adapters keyed by name — how the worker resolves which one to call for a job. */
export type NotificationChannelMap = Record<ChannelName, NotificationChannel>;

export const NOTIFICATION_CHANNELS = Symbol('NotificationChannelMap');
