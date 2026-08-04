import { randomUUID } from 'node:crypto';
import { pollMailpitMessageTo } from './support/mailpit-support';
import { pollNotificationRowsUntil } from './support/notification-db-support';
import {
  ORDER_CANCELLED,
  produceOrderLifecycleEvent,
} from './support/notification-order-events-support';

const gatedDescribe = process.env.RUN_NOTIFICATION_E2E === '1' ? describe : describe.skip;

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

gatedDescribe('notification order.events dispatch (e2e)', () => {
  it('sends a real email through Mailpit + all channels land SENT for OrderConfirmed', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const eventId = await produceOrderLifecycleEvent({ orderId, userId, tenantId: TENANT });

    const rows = await pollNotificationRowsUntil(eventId, 3, ['SENT']);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.channel).sort()).toEqual(['email', 'push', 'sms']);

    const emailRow = rows.find((row) => row.channel === 'email');
    const message = await pollMailpitMessageTo(emailRow?.recipient ?? '');
    expect(message.subject).toBe('Your order is confirmed');
    expect(message.text).toContain(orderId);
  });

  it('dispatches OrderCancelled with the cancellation copy', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const eventId = await produceOrderLifecycleEvent({
      orderId,
      userId,
      tenantId: TENANT,
      eventType: ORDER_CANCELLED,
    });

    const rows = await pollNotificationRowsUntil(eventId, 3, ['SENT']);
    const emailRow = rows.find((row) => row.channel === 'email');
    const message = await pollMailpitMessageTo(emailRow?.recipient ?? '');
    expect(message.subject).toBe('Your order was cancelled');
    expect(message.text).toContain(orderId);
  });

  it('is idempotent by event id — a redelivered event creates no duplicate rows', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const eventId = randomUUID();
    await produceOrderLifecycleEvent({ orderId, userId, tenantId: TENANT, eventId });
    await produceOrderLifecycleEvent({ orderId, userId, tenantId: TENANT, eventId });

    const rows = await pollNotificationRowsUntil(eventId, 3, ['SENT']);
    expect(rows).toHaveLength(3);
  });
});

const dlqGatedDescribe = process.env.RUN_NOTIFICATION_DLQ_E2E === '1' ? describe : describe.skip;

dlqGatedDescribe('notification send exhaustion -> DLQ (e2e, requires Mailpit stopped)', () => {
  it('marks the email row DEAD and parks the payload after NOTIFY_MAX_ATTEMPTS failures', async () => {
    const orderId = randomUUID();
    const userId = randomUUID();
    const eventId = await produceOrderLifecycleEvent({ orderId, userId, tenantId: TENANT });

    const rows = await pollNotificationRowsUntil(eventId, 3, ['SENT', 'DEAD'], 120_000);
    const emailRow = rows.find((row) => row.channel === 'email');
    expect(emailRow?.status).toBe('DEAD');
    expect(emailRow?.error).toBeTruthy();
    const stubRows = rows.filter((row) => row.channel !== 'email');
    expect(stubRows.every((row) => row.status === 'SENT')).toBe(true);
  });
});
