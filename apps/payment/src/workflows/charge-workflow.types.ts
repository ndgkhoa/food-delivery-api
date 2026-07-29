/**
 * The durable-execution contract shared between the workflow, the activities,
 * and the Nest wiring. This file is imported by the workflow, so it MUST stay
 * pure: no imports at all — only plain TypeScript types and string constants.
 * Anything with a runtime import (Nest, TypeORM, config, node built-ins) would
 * be pulled into Temporal's deterministic workflow sandbox and break replay.
 */

/** Temporal workflow type name — used to start the workflow by name from the client. */
export const CHARGE_WORKFLOW_TYPE = 'chargeWorkflow';

/** Signal name a verified webhook uses to reconcile an async provider result. */
export const PROVIDER_RESULT_SIGNAL = 'providerResult';

/** Input the order saga's `ChargePayment` command carries into the workflow. */
export interface ChargeWorkflowInput {
  orderId: string;
  totalCents: number;
  /** Saga-wide trace id carried onto the emitted reply so the whole saga shares one id. */
  correlationId: string;
  /** Tenant the emit-reply activity re-establishes scope under when writing the outbox. */
  tenantId: string;
}

/** Outcome of a charge attempt — from the charge activity or a webhook signal. */
export interface ProviderResult {
  ok: boolean;
  reason?: string;
}

/** Argument to the charge activity (the only place the deterministic stub rule runs). */
export interface ChargeActivityInput {
  totalCents: number;
}

/** Argument to the emit-reply activity (writes the reply to the payment outbox). */
export interface EmitReplyActivityInput {
  orderId: string;
  ok: boolean;
  reason?: string;
  correlationId: string;
  tenantId: string;
}

/** Activity interface the workflow proxies — all IO/config lives behind these. */
export interface PaymentActivities {
  charge(input: ChargeActivityInput): Promise<ProviderResult>;
  emitReply(input: EmitReplyActivityInput): Promise<void>;
}
