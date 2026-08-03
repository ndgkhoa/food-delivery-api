import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import {
  DispatchOrderEventHandler,
  ORDER_CANCELLED,
  ORDER_CONFIRMED,
  type OrderLifecyclePayload,
} from '@notification/application/dispatch-order-event.handler';
import {
  FakeNotificationQueue,
  FakeNotificationRepository,
  FakeProcessedEvents,
  FakeRecipientResolver,
  fakeConfig,
  passthroughTransaction,
} from '@notification/application/notification-test-doubles';

const ENABLED = {
  NOTIFY_EMAIL_ENABLED: true,
  NOTIFY_SMS_ENABLED: true,
  NOTIFY_PUSH_ENABLED: true,
};

function envelope(
  eventType: string,
  overrides: Partial<EventEnvelopeHeaders> = {},
): EventEnvelopeHeaders {
  return {
    eventId: 'event-1',
    eventType,
    aggregateId: 'order-1',
    tenantId: 'tenant-a',
    correlationId: 'corr-1',
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

const payload: OrderLifecyclePayload = { orderId: 'order-1', userId: 'user-1' };

function build(configOverrides: Record<string, unknown> = {}) {
  const repository = new FakeNotificationRepository();
  const queue = new FakeNotificationQueue();
  const processedEvents = new FakeProcessedEvents();
  const recipientResolver = new FakeRecipientResolver({
    email: 'user-1@example.test',
    phone: '+15551234567',
    pushToken: 'push-user-1',
  });
  const handler = new DispatchOrderEventHandler(
    repository,
    recipientResolver,
    queue,
    processedEvents,
    passthroughTransaction,
    fakeConfig({ ...ENABLED, ...configOverrides }),
  );
  return { repository, queue, processedEvents, handler };
}

describe('DispatchOrderEventHandler', () => {
  it('creates one PENDING row + enqueues one job per enabled channel for OrderConfirmed', async () => {
    const { repository, queue, handler } = build();

    await handler.execute(envelope(ORDER_CONFIRMED), payload);

    expect(repository.rows.size).toBe(3);
    for (const row of repository.rows.values()) {
      expect(row.status).toBe('PENDING');
      expect(row.type).toBe('order-confirmed');
      expect(row.eventId).toBe('event-1');
      expect(row.tenantId).toBe('tenant-a');
    }
    expect(queue.enqueued).toHaveLength(3);
    const byChannel = Object.fromEntries(queue.enqueued.map((job) => [job.channel, job.payload]));
    expect(byChannel.email.recipient).toBe('user-1@example.test');
    expect(byChannel.sms.recipient).toBe('+15551234567');
    expect(byChannel.push.recipient).toBe('push-user-1');
    expect(byChannel.email.data).toEqual({ orderId: 'order-1' });
  });

  it('maps OrderCancelled to the order-cancelled notification type', async () => {
    const { repository, handler } = build();

    await handler.execute(envelope(ORDER_CANCELLED), payload);

    for (const row of repository.rows.values()) {
      expect(row.type).toBe('order-cancelled');
    }
  });

  it('only creates rows/jobs for enabled channels', async () => {
    const { repository, queue, handler } = build({ NOTIFY_SMS_ENABLED: false });

    await handler.execute(envelope(ORDER_CONFIRMED), payload);

    expect(repository.rows.size).toBe(2);
    expect(queue.enqueued.map((job) => job.channel).sort()).toEqual(['email', 'push']);
  });

  it('is idempotent by event id — a redelivered event creates no duplicate rows or jobs', async () => {
    const { repository, queue, handler } = build();

    await handler.execute(envelope(ORDER_CONFIRMED), payload);
    await handler.execute(envelope(ORDER_CONFIRMED), payload);

    expect(repository.rows.size).toBe(3);
    expect(queue.enqueued).toHaveLength(3);
  });

  it('re-drives a stranded PENDING row when a prior enqueue failed (no silent loss)', async () => {
    const { repository, queue, handler } = build();
    queue.failNext = true;

    // First delivery: rows commit, then the first enqueue throws — the event is
    // not swallowed, it propagates so the consumer will redeliver.
    await expect(handler.execute(envelope(ORDER_CONFIRMED), payload)).rejects.toThrow();
    expect(repository.rows.size).toBe(3);

    // Redelivery: create is deduped, but the still-PENDING rows are re-enqueued.
    await handler.execute(envelope(ORDER_CONFIRMED), payload);

    expect(repository.rows.size).toBe(3);
    expect(queue.enqueued).toHaveLength(3);
  });

  it('ignores an unknown order event type', async () => {
    const { repository, queue, handler } = build();

    await handler.execute(envelope('SomeOtherEvent'), payload);

    expect(repository.rows.size).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });
});
