import { HandleSendFailureHandler } from '@notification/application/handle-send-failure.handler';
import type { NotificationJobPayload } from '@notification/domain/notification/notification-queue.port';
import {
  FakeNotificationDlq,
  FakeNotificationRepository,
  fakeConfig,
} from '@notification/testing/notification-test-doubles';

function jobPayload(overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload {
  return {
    notificationId: 'notification-1',
    channel: 'email',
    type: 'order-confirmed',
    recipient: 'user-1@example.test',
    tenantId: 'tenant-a',
    data: { orderId: 'order-1' },
    ...overrides,
  };
}

function build(maxAttempts = 5) {
  const repository = new FakeNotificationRepository();
  const dlq = new FakeNotificationDlq();
  const handler = new HandleSendFailureHandler(
    repository,
    dlq,
    fakeConfig({ NOTIFY_MAX_ATTEMPTS: maxAttempts }),
  );
  return { repository, dlq, handler };
}

describe('HandleSendFailureHandler', () => {
  it('marks the row FAILED (retryable) below the attempt ceiling — no DLQ park', async () => {
    const { repository, dlq, handler } = build(5);
    await repository.createPendingBatch([
      {
        tenantId: 'tenant-a',
        eventId: 'event-1',
        channel: 'email',
        recipient: 'user-1@example.test',
        type: 'order-confirmed',
      },
    ]);
    const [notification] = [...repository.rows.values()];

    await handler.execute(jobPayload({ notificationId: notification.id }), 2, 'smtp timeout');

    expect(repository.rows.get(notification.id)).toMatchObject({
      status: 'FAILED',
      attempts: 2,
      error: 'smtp timeout',
    });
    expect(dlq.parked).toHaveLength(0);
  });

  it('marks the row DEAD and parks the payload to notify-dlq once attempts reach the ceiling', async () => {
    const { repository, dlq, handler } = build(5);
    await repository.createPendingBatch([
      {
        tenantId: 'tenant-a',
        eventId: 'event-1',
        channel: 'sms',
        recipient: '+15551234567',
        type: 'order-cancelled',
      },
    ]);
    const [notification] = [...repository.rows.values()];

    await handler.execute(
      jobPayload({ notificationId: notification.id, channel: 'sms' }),
      5,
      'provider unreachable',
    );

    expect(repository.rows.get(notification.id)).toMatchObject({
      status: 'DEAD',
      attempts: 5,
      error: 'provider unreachable',
    });
    expect(dlq.parked).toHaveLength(1);
    expect(dlq.parked[0]).toMatchObject({
      notificationId: notification.id,
      channel: 'sms',
      error: 'provider unreachable',
    });
  });

  it('parks to notify-dlq once attempts exceed the ceiling (defensive — should not normally happen)', async () => {
    const { repository, dlq, handler } = build(3);
    await repository.createPendingBatch([
      {
        tenantId: 'tenant-a',
        eventId: 'event-1',
        channel: 'push',
        recipient: 'push-token',
        type: 'order-confirmed',
      },
    ]);
    const [notification] = [...repository.rows.values()];

    await handler.execute(
      jobPayload({ notificationId: notification.id, channel: 'push' }),
      4,
      'boom',
    );

    expect(repository.rows.get(notification.id)?.status).toBe('DEAD');
    expect(dlq.parked).toHaveLength(1);
  });
});
