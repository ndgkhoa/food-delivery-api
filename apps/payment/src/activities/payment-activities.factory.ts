import type { PaymentActivities } from '@payment/workflows/charge-workflow.types';
import { type ChargeActivityDeps, createChargeActivity } from './charge.activity';
import { createEmitReplyActivity, type EmitReplyActivityDeps } from './emit-reply.activity';

/** All deps the payment activities need — supplied by the worker provider from Nest DI. */
export type PaymentActivitiesDeps = ChargeActivityDeps & EmitReplyActivityDeps;

/**
 * Assembles the concrete activity implementations Temporal registers on the task
 * queue, each closing over its injected Nest services. Activities are plain
 * functions (not Nest providers), so this factory is the seam that hands them
 * their IO/config dependencies at worker-provider construction time.
 */
export function createPaymentActivities(deps: PaymentActivitiesDeps): PaymentActivities {
  return {
    charge: createChargeActivity(deps),
    emitReply: createEmitReplyActivity(deps),
  };
}
