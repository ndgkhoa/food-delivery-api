import type { ChargeWorkflowInput, ProviderResult } from '@payment/workflows/charge-workflow.types';

/**
 * Port the messaging + HTTP edges use to drive the durable charge workflow,
 * without depending on the Temporal client adapter directly. The infrastructure
 * adapter owns starting the workflow idempotently by id and signalling it.
 */
export interface WorkflowGatewayPort {
  /** Starts `charge-{orderId}`; a redelivered command that hits the same id is an idempotent no-op. */
  startCharge(input: ChargeWorkflowInput): Promise<void>;
  /** Signals the running charge workflow with an async provider result (from the webhook). */
  signalProviderResult(orderId: string, result: ProviderResult): Promise<void>;
}

export const WORKFLOW_GATEWAY = Symbol('WorkflowGateway');
