import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { TEMPORAL_CONNECTION } from '@payment/infrastructure/temporal/temporal.tokens';
import type { Connection } from '@temporalio/client';

/**
 * Closes the Temporal client `Connection` (its gRPC channel) on app shutdown so
 * the process exits cleanly on SIGTERM/SIGINT. The connection is opened by the
 * client module's factory on init; this owns the matching teardown.
 */
@Injectable()
export class TemporalConnectionCloser implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CONNECTION) private readonly connection: Connection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
