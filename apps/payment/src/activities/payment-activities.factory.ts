import { type ChargeActivityDeps, createChargeActivity } from '@payment/activities/charge.activity';
import {
  createEmitReplyActivity,
  type EmitReplyActivityDeps,
} from '@payment/activities/emit-reply.activity';
import type { PaymentActivities } from '@payment/workflows/charge-workflow.types';

export type PaymentActivitiesDeps = ChargeActivityDeps & EmitReplyActivityDeps;

export function createPaymentActivities(deps: PaymentActivitiesDeps): PaymentActivities {
  return {
    charge: createChargeActivity(deps),
    emitReply: createEmitReplyActivity(deps),
  };
}
