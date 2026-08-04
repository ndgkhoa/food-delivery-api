import { captureActiveTraceContext } from '@food-delivery-api/shared-observability';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_WRITER, type OutboxWriter } from '@payment/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@payment/domain/shared/transaction.port';
import type { WorkflowGatewayPort } from '@payment/domain/shared/workflow-gateway.port';
import { WORKFLOW_CLIENT } from '@payment/infrastructure/temporal/temporal.tokens';
import {
  paymentFailedReply,
  paymentSucceededReply,
} from '@payment/interface/messaging/payment-reply-factory';
import {
  CHARGE_WORKFLOW_TYPE,
  type ChargeWorkflowInput,
  PROVIDER_RESULT_SIGNAL,
  type ProviderResult,
} from '@payment/workflows/charge-workflow.types';
import {
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

function chargeWorkflowId(orderId: string): string {
  return `charge-${orderId}`;
}

@Injectable()
export class TemporalWorkflowGatewayAdapter implements WorkflowGatewayPort {
  private readonly logger = new Logger(TemporalWorkflowGatewayAdapter.name);
  private readonly taskQueue: string;

  constructor(
    @Inject(WORKFLOW_CLIENT) private readonly client: WorkflowClient,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.taskQueue = config.getOrThrow<string>('TEMPORAL_TASK_QUEUE');
  }

  async startCharge(input: ChargeWorkflowInput): Promise<void> {
    const traceParent = input.traceParent ?? captureActiveTraceContext().traceparent;
    try {
      await this.client.start(CHARGE_WORKFLOW_TYPE, {
        workflowId: chargeWorkflowId(input.orderId),
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        taskQueue: this.taskQueue,
        args: [{ ...input, traceParent }],
      });
      this.logger.log(`Started charge workflow for order ${input.orderId}`);
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        await this.recoverReplyForDuplicateStart(input);
        return;
      }
      throw error;
    }
  }

  private async recoverReplyForDuplicateStart(input: ChargeWorkflowInput): Promise<void> {
    const handle = this.client.getHandle<() => Promise<ProviderResult>>(
      chargeWorkflowId(input.orderId),
    );
    let statusName: string;
    try {
      statusName = (await handle.describe()).status.name;
    } catch (describeError) {
      this.logger.warn(
        `Charge workflow already running for order ${input.orderId} — describe failed, no-op: ` +
          `${describeError instanceof Error ? describeError.message : String(describeError)}`,
      );
      return;
    }

    if (statusName !== 'COMPLETED') {
      this.logger.log(`Charge workflow already running for order ${input.orderId} — no-op`);
      return;
    }

    try {
      const result = await handle.result();
      const reply = result.ok
        ? paymentSucceededReply(input.orderId, input.correlationId)
        : paymentFailedReply(
            input.orderId,
            result.reason ?? 'payment declined',
            input.correlationId,
          );
      await this.tenantContext.run({ tenantId: input.tenantId, actor: 'system', roles: [] }, () =>
        this.transaction.runInTransaction(() => this.outbox.append(reply)),
      );
      this.logger.log(
        `Re-appended reply for completed charge workflow, order ${input.orderId} (ok=${result.ok})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to recover reply for completed charge workflow, order ${input.orderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async signalProviderResult(orderId: string, result: ProviderResult): Promise<void> {
    const handle = this.client.getHandle(chargeWorkflowId(orderId));
    try {
      await handle.signal(PROVIDER_RESULT_SIGNAL, result);
      this.logger.log(`Signalled provider result for order ${orderId} (ok=${result.ok})`);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        this.logger.log(`Charge workflow for order ${orderId} already closed — signal ignored`);
        return;
      }
      throw error;
    }
  }
}
