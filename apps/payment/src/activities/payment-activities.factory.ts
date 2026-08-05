import type { PaymentActivities } from '@payment/workflows/charge-workflow.types';
import { type ChargeActivityDeps, createChargeActivity } from './charge.activity';
import { createEmitReplyActivity, type EmitReplyActivityDeps } from './emit-reply.activity';

export type PaymentActivitiesDeps = ChargeActivityDeps & EmitReplyActivityDeps;

export function createPaymentActivities(deps: PaymentActivitiesDeps): PaymentActivities {
  return {
    charge: createChargeActivity(deps),
    emitReply: createEmitReplyActivity(deps),
  };
}
