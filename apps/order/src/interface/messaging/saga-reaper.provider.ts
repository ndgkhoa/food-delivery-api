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

/**
 * Distinct Postgres advisory-lock key so the reconcile sweep serializes across
 * HPA replicas. Kept distinct from every outbox relay's own lock key (order
 * 4001, payment 4002, inventory 4003, review 4004) even though it lives in the
 * same order database, purely so a lock wait-list dump is unambiguous.
 */
const SAGA_RECONCILER_LOCK_KEY = 5001;

/**
 * Periodic stranded-saga sweep — the pre-DLQ safety net. A saga can strand if a
 * reply is lost (now dead-lettered, or genuinely never produced): it sits in a
 * non-terminal state indefinitely with a reserved stock hold outstanding. This
 * reaper scans for non-terminal sagas older than a configured timeout and
 * RECOVERS each one by re-emitting the idempotent command its current state is
 * waiting on: inventory reserves/releases idempotently by order id; for
 * payment, re-emitting `ChargePayment` hits `REJECT_DUPLICATE` on the
 * already-completed charge workflow, and the payment gateway adapter recovers
 * by re-appending that run's decided reply under a fresh event id (never a
 * second charge) — the redelivered command gives the saga a fresh chance to
 * reach a terminal state. Each re-drive is guarded: the attempts-increment
 * only commits if the saga is still in the state the decision was made for,
 * so a concurrent real reply that already advanced it rolls the re-drive back
 * instead of acting on stale intent. A saga that makes no progress after
 * `SAGA_RECONCILER_MAX_ATTEMPTS` re-drives is escalated (ERROR log + metric)
 * instead of looped forever. The whole sweep runs under a Postgres advisory
 * lock so only one HPA replica reconciles per tick. Disabled under
 * NODE_ENV=test (no scheduler in unit/integration).
 */
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
    // Never keep the event loop alive for the sweep timer.
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

  /**
   * One sweep: find stranded sagas and recover each (re-drive or escalate).
   * Runs under a session-held advisory lock so only one replica reconciles per
   * tick; `ran: false` (another replica holds the lock) is a normal skip, not
   * an error. Exposed for an off-cycle trigger/tests. Never throws — a down DB
   * or a broken re-drive must never crash the timer.
   */
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

  /** Runs under the advisory lock: find the stranded worklist, then recover each row. */
  private async reconcile(): Promise<number> {
    const now = new Date();
    // The DB bounds the fetch to sagas idle past the timeout (index-backed);
    // selectStrandedSagas re-applies the same rule as the authoritative,
    // unit-tested selection so the two can never silently drift.
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

  /**
   * Recovers a single stranded saga: re-drive (append the command + bump
   * attempts in one transaction) or escalate. Its own try/catch so one bad
   * row (a raced delete, a transient DB error) never stalls the rest of the
   * sweep — every stranded saga gets its own independent shot each tick. A
   * `SagaStateChangedError` (a concurrent real reply advanced the saga between
   * the read above and the guarded write) is caught separately: it is an
   * expected, healthy outcome — the saga is progressing on its own — not a
   * failure, so it is logged quietly and never counted as redriven/escalated.
   */
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

      // The outbox writer reads the tenant off ambient request-scoped context
      // (never a caller-supplied value, so no call site can spoof it) — the
      // reaper runs on a timer with no request, so it opens that scope itself
      // for the saga's own tenant before writing.
      await this.tenantContext.run(
        { tenantId: candidate.tenantId, actor: 'system', roles: [] },
        () =>
          this.transaction.runInTransaction(async () => {
            // Guard FIRST: only append the re-drive command once the
            // conditional attempts-increment confirms the saga is still in
            // the state the decision above was made for. A concurrent real
            // reply that already advanced it throws here, before the append
            // below ever stages a command for a saga that moved on its own.
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
