import {
  DuplicateEventError,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import type { ConfigService } from '@nestjs/config';
import type {
  ChannelName,
  NewNotification,
  Notification,
} from '@notification/domain/notification/notification';
import type { NotificationRepository } from '@notification/domain/notification/notification.repository';
import type { NotificationChannelMap } from '@notification/domain/notification/notification-channel.port';
import type {
  NotificationDlqPort,
  NotificationJobPayload,
  NotificationQueuePort,
} from '@notification/domain/notification/notification-queue.port';
import type {
  Recipient,
  RecipientResolverPort,
} from '@notification/domain/notification/recipient-resolver.port';
import type { TransactionPort } from '@notification/domain/shared/transaction.port';

let sequence = 0;

/** In-memory `notifications` ledger — no DB, backs both dispatch + worker use cases. */
export class FakeNotificationRepository implements NotificationRepository {
  readonly rows = new Map<string, Notification>();

  async createPendingBatch(rows: NewNotification[]): Promise<Notification[]> {
    const now = new Date();
    return rows.map((row) => {
      sequence += 1;
      const notification: Notification = {
        id: `notification-${sequence}`,
        tenantId: row.tenantId,
        eventId: row.eventId,
        channel: row.channel,
        recipient: row.recipient,
        type: row.type,
        status: 'PENDING',
        attempts: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      this.rows.set(notification.id, notification);
      return notification;
    });
  }

  async findPendingByEvent(tenantId: string, eventId: string): Promise<Notification[]> {
    return [...this.rows.values()].filter(
      (row) => row.tenantId === tenantId && row.eventId === eventId && row.status === 'PENDING',
    );
  }

  async findById(id: string): Promise<Notification | null> {
    return this.rows.get(id) ?? null;
  }

  async markSent(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status: 'SENT', error: null });
    }
  }

  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status: 'FAILED', attempts, error });
    }
  }

  async markDead(id: string, attempts: number, error: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status: 'DEAD', attempts, error });
    }
  }
}

/**
 * Records enqueued jobs per channel — no Redis. Dedupes by `notificationId` to
 * model BullMQ's `jobId` behaviour (a duplicate job for a still-pending id is
 * ignored), so re-driving the same PENDING rows enqueues each job at most once.
 * `failNext` makes the next enqueue throw, to exercise the re-drive path.
 */
export class FakeNotificationQueue implements NotificationQueuePort {
  readonly enqueued: { channel: ChannelName; payload: NotificationJobPayload }[] = [];
  private readonly seen = new Set<string>();
  failNext = false;

  async enqueue(channel: ChannelName, payload: NotificationJobPayload): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis unavailable');
    }
    if (this.seen.has(payload.notificationId)) {
      return;
    }
    this.seen.add(payload.notificationId);
    this.enqueued.push({ channel, payload });
  }
}

/** Records parked DLQ payloads — no Redis. */
export class FakeNotificationDlq implements NotificationDlqPort {
  readonly parked: (NotificationJobPayload & { error: string })[] = [];

  async park(payload: NotificationJobPayload & { error: string }): Promise<void> {
    this.parked.push(payload);
  }
}

/** Deterministic recipient — no dependency on the real stub's derivation. */
export class FakeRecipientResolver implements RecipientResolverPort {
  constructor(private readonly recipient: Recipient) {}

  async resolve(): Promise<Recipient> {
    return this.recipient;
  }
}

/** Dedupe store that records the first event id and rejects a repeat — mirrors the real ledger's behavior. */
export class FakeProcessedEvents implements ProcessedEventStorePort {
  readonly seen = new Set<string>();

  async markProcessed(_tx: unknown, eventId: string): Promise<void> {
    if (this.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    this.seen.add(eventId);
  }
}

/** Passes work straight through — the real adapter's transaction boundary isn't needed for logic tests. */
export const passthroughTransaction: TransactionPort = { runInTransaction: (work) => work() };

/** Minimal ConfigService stand-in exposing only `getOrThrow` over a fixed map. */
export function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    getOrThrow: <T>(key: string): T => {
      if (!(key in values)) {
        throw new Error(`missing config "${key}"`);
      }
      return values[key] as T;
    },
  } as unknown as ConfigService;
}

/** Every channel resolves to the given fixed adapter (usually a jest.fn()-backed test double). */
export function fixedChannelMap(
  channel: NotificationChannelMap[ChannelName],
): NotificationChannelMap {
  return { email: channel, sms: channel, push: channel };
}
