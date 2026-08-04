import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${ORDERS_FACT_TABLE}
  (
    tenant_id String,
    order_id String,
    restaurant_id String,
    user_id String,
    status LowCardinality(String),
    total_cents Int64,
    occurred_at DateTime64(3),
    ingested_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(ingested_at)
  ORDER BY (tenant_id, order_id)
`;

@Injectable()
export class OrdersFactSchemaBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrdersFactSchemaBootstrap.name);

  constructor(
    @Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Schema bootstrap disabled (NODE_ENV=test): ${ORDERS_FACT_TABLE} not created`,
      );
      return;
    }
    await this.createDatabaseIfAbsent();
    await this.client.command({ query: CREATE_TABLE_SQL });
    this.logger.log(`Ensured ${ORDERS_FACT_TABLE} exists (ReplacingMergeTree)`);
  }

  private async createDatabaseIfAbsent(): Promise<void> {
    const database = this.config.getOrThrow<string>('CLICKHOUSE_DATABASE');
    const bootstrapClient = createClient({
      url: this.config.getOrThrow<string>('CLICKHOUSE_URL'),
      username: this.config.getOrThrow<string>('CLICKHOUSE_USER'),
      password: this.config.get<string>('CLICKHOUSE_PASSWORD') ?? '',
    });
    try {
      await bootstrapClient.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
    } finally {
      await bootstrapClient.close();
    }
  }
}
