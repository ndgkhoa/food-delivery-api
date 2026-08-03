import {
  CLICKHOUSE_CLIENT,
  ORDERS_FACT_TABLE,
} from '@analytics/infrastructure/clickhouse/clickhouse.tokens';
import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fact table DDL: a `ReplacingMergeTree` versioned by `ingested_at` so a
 * redelivered `order.events` message (same `tenant_id`/`order_id`) collapses
 * to its latest insert on merge — dashboards read it back with `FINAL` or a
 * `GROUP BY`, never relying on merges having already happened. `restaurant_id`
 * is a plain `String` (never `Nullable`): the ingest handler writes `''` for a
 * straggler order with no restaurant attribution.
 */
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

/**
 * Provisions the analytics database + `orders_fact` table (create-if-absent)
 * on boot — ClickHouse has no SQL migration tooling here, so the schema is
 * code-bootstrapped like search's Elasticsearch index. Skipped under
 * NODE_ENV=test: in-process integration tests boot the module graph without a
 * live ClickHouse node. Logged (not silent) so a mis-set NODE_ENV in a real
 * environment is visible rather than a ghost that leaves the table missing.
 */
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

  /**
   * `CREATE DATABASE IF NOT EXISTS` must run against a connection that does
   * NOT already select the target database — ClickHouse's HTTP interface
   * switches to the request's `database` query param before the query body is
   * even parsed, so the main (database-scoped) client would fail with
   * "database doesn't exist" on its very first call. A short-lived,
   * unscoped client sidesteps that chicken-and-egg problem.
   */
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
