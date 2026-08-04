import {
  recordSagaReconcileEscalated,
  recordSagaReconcileRedriven,
} from '@food-delivery-api/shared-observability';
import { withAdvisoryLock } from '@food-delivery-api/shared-persistence';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { decideReconcileAction } from '@order/application/saga/saga-reconciler';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import {
  type StrandedSagaCandidate,
  selectStrandedSagas,
} from '@order/domain/saga/stranded-saga-sweep';
import { SagaStateChangedError } from '@order/domain/shared/errors';
import { OUTBOX_WRITER, type OutboxWriter } from '@order/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@order/domain/shared/transaction.port';
import type { DataSource } from 'typeorm';

const SAGA_RECONCILER_LOCK_KEY = 5001;

@Injectable()
export class SagaReaperProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SagaReaperProvider.name);
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private strandedTotal = 0;

  constructor(
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.timeoutMs = this.config.getOrThrow<number>('SAGA_REAPER_TIMEOUT_MS');
    this.intervalMs = this.config.getOrThrow<number>('SAGA_REAPER_INTERVAL_MS');
    this.maxAttempts = this.config.getOrThrow<number>('SAGA_RECONCILER_MAX_ATTEMPTS');
  }

  onApplicationBootstrap(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('Saga reaper disabled (NODE_ENV=test)');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.intervalMs);
    this.timer.unref();
    this.logger.log(
      `Saga reaper started (timeout ${this.timeoutMs}ms, interval ${this.intervalMs}ms, max attempts ${this.maxAttempts})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<number> {
    try {
      const outcome = await withAdvisoryLock(this.dataSource, SAGA_RECONCILER_LOCK_KEY, () =>
        this.reconcile(),
      );
      return outcome.ran ? outcome.result : 0;
    } catch (error) {
      this.logger.error(
        `Saga reaper sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  private async reconcile(): Promise<number> {
    const now = new Date();
    const olderThan = new Date(now.getTime() - this.timeoutMs);
    const candidates = await this.sagaRepository.findNonTerminal(olderThan);
    const stranded = selectStrandedSagas(candidates, now, this.timeoutMs);
    if (stranded.length === 0) {
      return 0;
    }

    this.strandedTotal += stranded.length;
    this.logger.warn(
      `Stranded-saga worklist (${stranded.length}; ${this.strandedTotal} total): ` +
        stranded
          .map((saga) => `${saga.orderId}[${saga.state}]@${saga.updatedAt.toISOString()}`)
          .join(', '),
    );

    for (const candidate of stranded) {
      await this.recoverOne(candidate);
    }
    return stranded.length;
  }

  private async recoverOne(candidate: StrandedSagaCandidate): Promise<void> {
    try {
      const saga = await this.sagaRepository.findByOrderId(candidate.tenantId, candidate.orderId);
      if (!saga) {
        this.logger.error(`Stranded-saga worklist raced a delete for order ${candidate.orderId}`);
        return;
      }
      const order = await this.orderRepository.findById(candidate.tenantId, candidate.orderId);
      if (!order) {
        this.logger.error(`Stranded saga for order ${candidate.orderId} has no order row`);
        return;
      }

      const action = decideReconcileAction(saga, order, this.maxAttempts);
      if (action.kind === 'escalate') {
        this.logger.error(
          `Saga for order ${candidate.orderId} escalated after ${saga.attempts} reconcile ` +
            `attempt(s) in state ${saga.state} — left for manual/DLQ-replay follow-up`,
        );
        recordSagaReconcileEscalated();
        return;
      }

      await this.tenantContext.run(
        { tenantId: candidate.tenantId, actor: 'system', roles: [] },
        () =>
          this.transaction.runInTransaction(async () => {
            await this.sagaRepository.recordReconcileAttempt(candidate.orderId, saga.state);
            await this.outbox.append(action.command);
          }),
      );
      recordSagaReconcileRedriven(saga.state);
    } catch (error) {
      if (error instanceof SagaStateChangedError) {
        this.logger.debug(
          `Saga for order ${candidate.orderId} progressed past ${error.expectedState} before ` +
            `the reconciler could re-drive it — skipping (not an error)`,
        );
        return;
      }
      this.logger.error(
        `Saga reconcile failed for order ${candidate.orderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
