import type { ChargeWorkflowInput, ProviderResult } from '@payment/workflows/charge-workflow.types';

export interface WorkflowGatewayPort {
  startCharge(input: ChargeWorkflowInput): Promise<void>;
  signalProviderResult(orderId: string, result: ProviderResult): Promise<void>;
}

export const WORKFLOW_GATEWAY = Symbol('WorkflowGateway');
