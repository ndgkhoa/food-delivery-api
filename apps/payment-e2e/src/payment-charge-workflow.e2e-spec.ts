import { randomUUID } from 'node:crypto';
import { collectRepliesForOrder, produceChargeCommand } from './support/payment-kafka-support';

/**
 * Compose-run durable-charge e2e for the payment Temporal workflow. It exercises
 * the real path: produce a `ChargePayment` on `payment.commands` → the payment
 * worker starts `charge-{orderId}` → the charge + emit-reply activities run → a
 * reply lands on `payment.replies` (the same contract the order saga consumes).
 *
 * Requires the live stack, so it is gated behind RUN_PAYMENT_E2E and executed by
 * the orchestrator, NOT the offline unit sandbox. Bring up:
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging --profile workflow up -d
 *   pnpm nx serve payment            # host worker + consumer + webhook
 *   RUN_PAYMENT_E2E=1 pnpm nx e2e payment-e2e
 *
 * The order CONFIRMED/CANCELLED lifecycle assertions live in order-e2e (which
 * places a real order); here we assert the payment reply contract directly.
 */
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
    // Same eventId + orderId twice → same workflow id `charge-{orderId}`.
    await produceChargeCommand({ orderId, totalCents: 4321, tenantId: TENANT, eventId });
    await produceChargeCommand({ orderId, totalCents: 4321, tenantId: TENANT, eventId });

    const replies = await collectRepliesForOrder(orderId);
    expect(replies).toHaveLength(1);
    expect(replies[0].eventType).toBe('PaymentSucceeded');
  });

  /**
   * Durability (worker-kill mid-charge) is proven manually / by the orchestrator:
   *   1. Produce a ChargePayment, then `docker kill`/SIGKILL the payment worker
   *      before the reply is emitted.
   *   2. Restart `pnpm nx serve payment`.
   *   3. The workflow resumes from history and emits exactly ONE reply; the order
   *      reaches its terminal state with no double charge. Inspect the run in the
   *      Temporal UI at http://localhost:8233.
   * The automated durability proof is the gated TestWorkflowEnvironment unit
   * spec (apps/payment/src/workflows/charge-workflow.spec.ts).
   */
  it.todo(
    'resumes mid-charge after a worker kill and emits exactly one reply (manual/orchestrator)',
  );
});
