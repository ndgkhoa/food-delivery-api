import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import { selectStrandedSagas } from '@order/domain/saga/stranded-saga-sweep';

/**
 * Periodic stranded-saga sweep — the pre-DLQ safety net. A saga can strand if a
 * reply is lost (now dead-lettered, or genuinely never produced): it sits in a
 * non-terminal state indefinitely with a reserved stock hold outstanding. This
 * reaper scans for non-terminal sagas older than a configured timeout and
 * reports them (a worklist + a count) so the condition is observable. It only
 * DISCOVERS here — it does not auto-compensate; timeout-driven recovery is a
 * later step. Disabled under NODE_ENV=test (no scheduler in unit/integration).
 */
@Injectable()
export class SagaReaperProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SagaReaperProvider.name);
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private strandedTotal = 0;

  constructor(
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    private readonly config: ConfigService,
  ) {
    this.timeoutMs = this.config.getOrThrow<number>('SAGA_REAPER_TIMEOUT_MS');
    this.intervalMs = this.config.getOrThrow<number>('SAGA_REAPER_INTERVAL_MS');
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
      `Saga reaper started (timeout ${this.timeoutMs}ms, interval ${this.intervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep: find + report stranded sagas. Exposed for an off-cycle trigger/tests. */
  async sweep(): Promise<number> {
    try {
      const candidates = await this.sagaRepository.findNonTerminal();
      const stranded = selectStrandedSagas(candidates, new Date(), this.timeoutMs);
      if (stranded.length > 0) {
        this.strandedTotal += stranded.length;
        this.logger.warn(
          `Stranded-saga worklist (${stranded.length}; ${this.strandedTotal} total): ` +
            stranded
              .map((saga) => `${saga.orderId}[${saga.state}]@${saga.updatedAt.toISOString()}`)
              .join(', '),
        );
      }
      return stranded.length;
    } catch (error) {
      this.logger.error(
        `Saga reaper sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
