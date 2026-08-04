export const CHARGE_WORKFLOW_TYPE = 'chargeWorkflow';

export const PROVIDER_RESULT_SIGNAL = 'providerResult';

export interface ChargeWorkflowInput {
  orderId: string;
  totalCents: number;
  correlationId: string;
  tenantId: string;
  traceParent?: string;
}

export interface ProviderResult {
  ok: boolean;
  reason?: string;
  pending?: boolean;
}

export interface ChargeActivityInput {
  totalCents: number;
}

export interface EmitReplyActivityInput {
  orderId: string;
  ok: boolean;
  reason?: string;
  correlationId: string;
  tenantId: string;
  traceParent?: string;
}

export interface PaymentActivities {
  charge(input: ChargeActivityInput): Promise<ProviderResult>;
  emitReply(input: EmitReplyActivityInput): Promise<void>;
}
