import { randomUUID } from 'node:crypto';
import { collectRepliesForOrder, produceChargeCommand } from './support/payment-kafka-support';

const gatedDescribe = process.env.RUN_PAYMENT_E2E === '1' ? describe : describe.skip;

const FAIL_AT_CENTS = Number(process.env.PAYMENT_STUB_FAIL_AT_CENTS ?? 66600);
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

gatedDescribe('payment durable charge workflow (e2e)', () => {
  it('charges a normal amount and emits exactly one PaymentSucceeded', async () => {
    const orderId = randomUUID();
    await produceChargeCommand({ orderId, totalCents: 1234, tenantId: TENANT });

    const replies = await collectRepliesForOrder(orderId);
    expect(replies).toHaveLength(1);
    expect(replies[0].eventType).toBe('PaymentSucceeded');
  });

  it('declines the deterministic trigger amount and emits PaymentFailed', async () => {
    const orderId = randomUUID();
    await produceChargeCommand({ orderId, totalCents: FAIL_AT_CENTS, tenantId: TENANT });

    const replies = await collectRepliesForOrder(orderId);
    expect(replies).toHaveLength(1);
    expect(replies[0].eventType).toBe('PaymentFailed');
    expect(replies[0].reason).toBeDefined();
  });

  it('is idempotent by workflow id — a redelivered command yields one reply', async () => {
    const orderId = randomUUID();
    const eventId = randomUUID();
    await produceChargeCommand({ orderId, totalCents: 4321, tenantId: TENANT, eventId });
    await produceChargeCommand({ orderId, totalCents: 4321, tenantId: TENANT, eventId });

    const replies = await collectRepliesForOrder(orderId);
    expect(replies).toHaveLength(1);
    expect(replies[0].eventType).toBe('PaymentSucceeded');
  });

  it.todo(
    'resumes mid-charge after a worker kill and emits exactly one reply (manual/orchestrator)',
  );
});
