import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import {
  type ChargeWorkflowInput,
  type PaymentActivities,
  PROVIDER_RESULT_SIGNAL,
  type ProviderResult,
} from './charge-workflow.types';

/**
 * Bounded window the workflow waits for a webhook to reconcile the provider's
 * async result after the synchronous charge attempt. Kept short so the default
 * (no-webhook) path stays snappy while still demonstrating Signals + timers.
 */
const RECONCILE_WINDOW = '2 seconds';

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
 * Default path: run the charge activity for a decision. A webhook can then
 * signal an async provider result within a bounded window; if it arrives it
 * reconciles (overrides) the decision. Either way exactly one reply is emitted
 * through the payment outbox via the emit-reply activity (itself idempotent by
 * order id), so the order saga sees `PaymentSucceeded`/`PaymentFailed` once.
 */
export async function chargeWorkflow(input: ChargeWorkflowInput): Promise<ProviderResult> {
  let reconciled: ProviderResult | undefined;
  setHandler(providerResultSignal, (result) => {
    reconciled = result;
  });

  const decided = await charge({ totalCents: input.totalCents });

  // Give a just-behind webhook a bounded chance to reconcile the async result.
  await condition(() => reconciled !== undefined, RECONCILE_WINDOW);
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
