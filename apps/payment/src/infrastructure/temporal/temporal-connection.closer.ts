import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { TEMPORAL_CONNECTION } from '@payment/infrastructure/temporal/temporal.tokens';
import type { Connection } from '@temporalio/client';

@Injectable()
export class TemporalConnectionCloser implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CONNECTION) private readonly connection: Connection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
