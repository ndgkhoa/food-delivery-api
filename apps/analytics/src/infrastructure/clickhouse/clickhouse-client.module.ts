import { CLICKHOUSE_CLIENT } from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const clickHouseClientProvider: Provider = {
  provide: CLICKHOUSE_CLIENT,
  useFactory: (config: ConfigService): ClickHouseClient =>
    createClient({
      url: config.getOrThrow<string>('CLICKHOUSE_URL'),
      username: config.getOrThrow<string>('CLICKHOUSE_USER'),
      password: config.get<string>('CLICKHOUSE_PASSWORD') ?? '',
      database: config.getOrThrow<string>('CLICKHOUSE_DATABASE'),
    }),
  inject: [ConfigService],
};

@Module({
  providers: [clickHouseClientProvider],
  exports: [CLICKHOUSE_CLIENT],
})
export class ClickHouseClientModule implements OnApplicationShutdown {
  constructor(@Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
