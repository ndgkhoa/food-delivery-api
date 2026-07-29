import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import {
  type ChargeWorkflowInput,
  type PaymentActivities,
  PROVIDER_RESULT_SIGNAL,
  type ProviderResult,
} from './charge-workflow.types';

/**
 * Bounded window the workflow waits for a webhook to reconcile an ASYNC provider
 * result. Only entered when the charge activity reports `pending` (a real async
 * PSP) — the synchronous stub skips it entirely, so the common path pays no timer
 * tax. Kept short to demonstrate Signals + timers without stalling a real charge.
 */
const RECONCILE_WINDOW = '30 seconds';

/**
 * Retry the charge activity with bounded exponential backoff. Temporal owns the
 * retries/timers declaratively — no hand-rolled loop — and resumes them from
 * history if the worker crashes mid-attempt (the durability lesson).
 */
const { charge, emitReply } = proxyActivities<PaymentActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 5,
  },
});

/** Async provider result delivered by the HMAC-verified webhook; buffered by Temporal until awaited. */
export const providerResultSignal = defineSignal<[ProviderResult]>(PROVIDER_RESULT_SIGNAL);

/**
 * Durable charge orchestration. Idempotent by workflow id (`charge-{orderId}`),
 * so a redelivered `ChargePayment` command that starts the same id is a no-op.
 * Run the charge activity for a decision. If that decision is `pending` (a real
 * async PSP), wait a bounded window for a webhook to signal the settled result,
 * which reconciles (overrides) the provisional decision; a synchronous decision
 * (the stub) emits immediately with no wait. Either way exactly one reply is
 * emitted through the payment outbox via the emit-reply activity (itself
 * idempotent by order id), so the order saga sees the reply once.
 */
export async function chargeWorkflow(input: ChargeWorkflowInput): Promise<ProviderResult> {
  let reconciled: ProviderResult | undefined;
  setHandler(providerResultSignal, (result) => {
    reconciled = result;
  });

  const decided = await charge({ totalCents: input.totalCents });

  // Only an async (pending) provider result waits for the webhook; a settled
  // decision skips the timer so the common path replies without latency.
  if (decided.pending) {
    await condition(() => reconciled !== undefined, RECONCILE_WINDOW);
  }
  const outcome = reconciled ?? decided;

  await emitReply({
    orderId: input.orderId,
    ok: outcome.ok,
    reason: outcome.reason,
    correlationId: input.correlationId,
    tenantId: input.tenantId,
  });

  return outcome;
}
