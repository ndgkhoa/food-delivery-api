/** Lifecycle of one channel send attempt for a dispatched order event. */
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';

/** The three delivery channels a dispatched event can fan out to. */
export type ChannelName = 'email' | 'sms' | 'push';

export const CHANNEL_NAMES: readonly ChannelName[] = ['email', 'sms', 'push'];

/**
 * One row per (event, channel): the record of a single channel's attempt to
 * notify a recipient about an order lifecycle event. `attempts`/`error` are
 * updated by the BullMQ worker as retries happen; `status` only ever advances
 * PENDING -> SENT, or PENDING -> FAILED (retryable) -> ... -> DEAD (exhausted).
 */
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

/** Fields needed to create a new PENDING notification row for one channel. */
export interface NewNotification {
  tenantId: string;
  eventId: string;
  channel: ChannelName;
  recipient: string;
  type: string;
}
