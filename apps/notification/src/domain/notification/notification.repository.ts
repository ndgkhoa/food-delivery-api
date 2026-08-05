import type { NewNotification, Notification } from '@notification/domain/notification/notification';

export interface NotificationRepository {
  createPendingBatch(rows: NewNotification[]): Promise<Notification[]>;
  findPendingByEvent(tenantId: string, eventId: string): Promise<Notification[]>;
  findById(id: string): Promise<Notification | null>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, attempts: number, error: string): Promise<void>;
  markDead(id: string, attempts: number, error: string): Promise<void>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NotificationRepository');
