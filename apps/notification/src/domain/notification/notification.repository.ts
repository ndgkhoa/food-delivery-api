import type { NewNotification, Notification } from '@notification/domain/notification/notification';

/** Persistence port for the `notifications` ledger. */
export interface NotificationRepository {
  /** Inserts one PENDING row per input — MUST run inside the caller's transaction. */
  createPendingBatch(rows: NewNotification[]): Promise<Notification[]>;
  /** Still-PENDING rows for one event — the enqueue driver re-drives these idempotently. */
  findPendingByEvent(tenantId: string, eventId: string): Promise<Notification[]>;
  findById(id: string): Promise<Notification | null>;
  markSent(id: string): Promise<void>;
  /** Records a retryable failure (BullMQ still owns the retry) — status is FAILED, not DEAD. */
  markFailed(id: string, attempts: number, error: string): Promise<void>;
  /** Records the exhausted-retry outcome — terminal, paired with a parked notify-dlq job. */
  markDead(id: string, attempts: number, error: string): Promise<void>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NotificationRepository');
