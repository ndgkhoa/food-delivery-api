import { resolve } from 'node:path';
import {
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPaymentActivities } from '@payment/activities/payment-activities.factory';
import { OUTBOX_WRITER, type OutboxWriter } from '@payment/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@payment/domain/shared/transaction.port';
import { NativeConnection, Worker } from '@temporalio/worker';

/**
 * Hosts the Temporal worker for the `payment-charges` task queue: it bundles the
 * deterministic `workflows/*` (via `workflowsPath` — a separate, sandboxed module
 * graph, free of Nest/TypeORM/config) and registers the activities built from
 * injected Nest services. The worker runs from bootstrap until a clean shutdown,
 * so an in-flight charge resumes from history on restart. Disabled under
 * NODE_ENV=test (no Temporal server in unit runs).
 */
@Injectable()
export class TemporalWorkerProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TemporalWorkerProvider.name);
  private worker?: Worker;
  private runPromise?: Promise<void>;
  private connection?: NativeConnection;

  constructor(
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('Temporal worker disabled (NODE_ENV=test)');
      return;
    }

    this.connection = await NativeConnection.connect({
      address: this.config.getOrThrow<string>('TEMPORAL_ADDRESS'),
    });

    this.worker = await Worker.create({
      connection: this.connection,
      namespace: this.config.getOrThrow<string>('TEMPORAL_NAMESPACE'),
      taskQueue: this.config.getOrThrow<string>('TEMPORAL_TASK_QUEUE'),
      // Temporal re-bundles this module into its own deterministic sandbox, so it
      // must resolve to a real on-disk path — NOT a bundler module id. The single
      // service bundle erases the source dir layout, so we resolve the workflows
      // dir from the workspace root (overridable) instead of `require.resolve`.
      workflowsPath: this.resolveWorkflowsPath(),
      activities: createPaymentActivities({
        failAtCents: this.config.getOrThrow<number>('PAYMENT_STUB_FAIL_AT_CENTS'),
        outbox: this.outbox,
        transaction: this.transaction,
        processedEvents: this.processedEvents,
        tenantContext: this.tenantContext,
      }),
    });

    // Do not await: run() resolves only when the worker stops. Surface a crash.
    this.runPromise = this.worker.run();
    this.runPromise.catch((error) => this.logger.error('Temporal worker crashed', error));
    this.logger.log(`Temporal worker running on task queue "${this.worker.options.taskQueue}"`);
  }

  /**
   * Absolute path to the `workflows/` dir Temporal bundles. Defaults to the
   * source tree under the workspace root (present when run via `nx serve` / from
   * the repo) and is overridable with `TEMPORAL_WORKFLOWS_PATH` for containerized
   * deployments that ship the workflow source/bundle at a different location.
   */
  private resolveWorkflowsPath(): string {
    const override = this.config.get<string>('TEMPORAL_WORKFLOWS_PATH');
    return resolve(override ?? 'apps/payment/src/workflows');
  }

  async onModuleDestroy(): Promise<void> {
    this.worker?.shutdown();
    await this.runPromise?.catch(() => undefined);
    await this.connection?.close();
  }
}
