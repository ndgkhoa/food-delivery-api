import { randomUUID } from 'node:crypto';
import { pollMailpitMessageTo } from './support/mailpit-support';
import { pollNotificationRowsUntil } from './support/notification-db-support';
import {
  ORDER_CANCELLED,
  produceOrderLifecycleEvent,
} from './support/notification-order-events-support';

/**
 * Compose-run e2e for the notification service's `order.events` dispatch. Real
 * path: produce an OrderConfirmed/OrderCancelled on `order.events` → the
 * notification worker dispatches PENDING rows + BullMQ jobs → the email
 * channel sends through Mailpit and the sms/push stubs log → every row lands
 * SENT.
 *
 * Requires the live stack, so it is gated behind RUN_NOTIFICATION_E2E and run
 * by the orchestrator, NOT the offline unit sandbox. Bring up:
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging --profile notification up -d
 *   pnpm db:migrate
 *   pnpm nx serve notification         # host consumer + workers
 *   RUN_NOTIFICATION_E2E=1 pnpm nx e2e notification-e2e
 */
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

/**
 * Exhausted-retry -> DEAD + notify-dlq requires the email channel to actually
 * fail every attempt, which needs Mailpit unreachable (not simulated). Run
 * manually/by the orchestrator:
 *   docker compose -f infra/docker-compose.yml --profile notification stop mailpit
 *   RUN_NOTIFICATION_DLQ_E2E=1 pnpm nx e2e notification-e2e
 *   docker compose -f infra/docker-compose.yml --profile notification start mailpit
 * NOTIFY_BACKOFF_MS=2000 with the default NOTIFY_MAX_ATTEMPTS=5 means the
 * exponential backoff (2s/4s/8s/16s) takes ~30s to exhaust — the 120s timeout
 * gives headroom. sms/push stubs never fail, so they land SENT even while
 * email is down, proving a channel outage doesn't stall the others.
 */
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
