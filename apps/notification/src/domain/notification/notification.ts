export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';

export type ChannelName = 'email' | 'sms' | 'push';

export const CHANNEL_NAMES: readonly ChannelName[] = ['email', 'sms', 'push'];

export interface Notification {
  id: string;
  tenantId: string;
  eventId: string;
  channel: ChannelName;
  recipient: string;
  type: string;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewNotification {
  tenantId: string;
  eventId: string;
  channel: ChannelName;
  recipient: string;
  type: string;
}
