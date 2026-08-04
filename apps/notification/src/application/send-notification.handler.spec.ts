import { SendNotificationHandler } from '@notification/application/send-notification.handler';
import type { NotificationChannel } from '@notification/domain/notification/notification-channel.port';
import type { NotificationJobPayload } from '@notification/domain/notification/notification-queue.port';
import {
  FakeNotificationRepository,
  fixedChannelMap,
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

describe('SendNotificationHandler', () => {
  it('sends via the resolved channel and marks the row SENT', async () => {
    const repository = new FakeNotificationRepository();
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
    const send = jest.fn().mockResolvedValue(undefined);
    const channel: NotificationChannel = { send };
    const handler = new SendNotificationHandler(repository, fixedChannelMap(channel));

    await handler.execute(jobPayload({ notificationId: notification.id }));

    expect(send).toHaveBeenCalledWith({
      recipient: 'user-1@example.test',
      type: 'order-confirmed',
      data: { orderId: 'order-1' },
    });
    expect(repository.rows.get(notification.id)?.status).toBe('SENT');
  });

  it('throws (leaving BullMQ to retry) and does not mark the row SENT when the channel send fails', async () => {
    const repository = new FakeNotificationRepository();
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
    const channel: NotificationChannel = {
      send: jest.fn().mockRejectedValue(new Error('smtp down')),
    };
    const handler = new SendNotificationHandler(repository, fixedChannelMap(channel));

    await expect(handler.execute(jobPayload({ notificationId: notification.id }))).rejects.toThrow(
      'smtp down',
    );
    expect(repository.rows.get(notification.id)?.status).toBe('PENDING');
  });

  it('does not re-send when the row is already SENT (at-least-once job re-run)', async () => {
    const repository = new FakeNotificationRepository();
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
    await repository.markSent(notification.id);
    const send = jest.fn().mockResolvedValue(undefined);
    const handler = new SendNotificationHandler(repository, fixedChannelMap({ send }));

    await handler.execute(jobPayload({ notificationId: notification.id }));

    expect(send).not.toHaveBeenCalled();
  });

  it('throws NotificationNotFoundError for an unknown notification id', async () => {
    const repository = new FakeNotificationRepository();
    const channel: NotificationChannel = { send: jest.fn() };
    const handler = new SendNotificationHandler(repository, fixedChannelMap(channel));

    await expect(handler.execute(jobPayload({ notificationId: 'missing' }))).rejects.toThrow(
      'Notification "missing" not found',
    );
  });
});
