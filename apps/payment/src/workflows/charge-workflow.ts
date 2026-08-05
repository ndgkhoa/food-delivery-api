import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import {
  type ChargeWorkflowInput,
  type PaymentActivities,
  PROVIDER_RESULT_SIGNAL,
  type ProviderResult,
} from './charge-workflow.types';

const RECONCILE_WINDOW = '30 seconds';

const { charge, emitReply } = proxyActivities<PaymentActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 5,
  },
});

export const providerResultSignal = defineSignal<[ProviderResult]>(PROVIDER_RESULT_SIGNAL);

export async function chargeWorkflow(input: ChargeWorkflowInput): Promise<ProviderResult> {
  let reconciled: ProviderResult | undefined;
  setHandler(providerResultSignal, (result) => {
    reconciled = result;
  });

  const decided = await charge({ totalCents: input.totalCents });

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
    traceParent: input.traceParent,
  });

  return outcome;
}
