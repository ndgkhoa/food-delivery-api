import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WORKFLOW_GATEWAY } from '@payment/domain/shared/workflow-gateway.port';
import { PersistenceModule } from '@payment/infrastructure/persistence/persistence.module';
import {
  TEMPORAL_CONNECTION,
  WORKFLOW_CLIENT,
} from '@payment/infrastructure/temporal/temporal.tokens';
import { TemporalConnectionCloser } from '@payment/infrastructure/temporal/temporal-connection.closer';
import { TemporalWorkerProvider } from '@payment/infrastructure/temporal/temporal-worker.provider';
import { TemporalWorkflowGatewayAdapter } from '@payment/infrastructure/temporal/temporal-workflow-gateway.adapter';
import { Connection, WorkflowClient } from '@temporalio/client';

/**
 * Temporal edge for the payment service: a client `Connection` + `WorkflowClient`
 * (start/signal workflows) and the worker that hosts the workflow + activities.
 * Connection opens on init and closes on shutdown. Imports `PersistenceModule`
 * so the worker provider can wire the emit-reply activity to the outbox writer,
 * transaction, and dedupe store.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: TEMPORAL_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Connection.connect({ address: config.getOrThrow<string>('TEMPORAL_ADDRESS') }),
    },
    {
      provide: WORKFLOW_CLIENT,
      inject: [TEMPORAL_CONNECTION, ConfigService],
      useFactory: (connection: Connection, config: ConfigService) =>
        new WorkflowClient({
          connection,
          namespace: config.getOrThrow<string>('TEMPORAL_NAMESPACE'),
        }),
    },
    { provide: WORKFLOW_GATEWAY, useClass: TemporalWorkflowGatewayAdapter },
    TemporalConnectionCloser,
    TemporalWorkerProvider,
  ],
  exports: [WORKFLOW_GATEWAY],
})
export class TemporalClientModule {}
