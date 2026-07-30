import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Analytics service env: the base 12-factor vars minus the DB_* block (the
 * dashboard read model lives in ClickHouse, not SQL, so there is no Postgres
 * database or migrations) plus ClickHouse connection coordinates and the Kafka
 * wiring for the `order.events` ingest consumer. `PORT` defaults to 3010 — the
 * next free port after review (3009).
 */
export const analyticsEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3010),
    /** ClickHouse HTTP interface URL (dev: single node, no TLS — never exposed via Nginx). */
    CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
    CLICKHOUSE_USER: z.string().min(1).default('default'),
    /** Empty by default (dev single-node has no password set); real deployments set a secret. */
    CLICKHOUSE_PASSWORD: z.string().default(''),
    CLICKHOUSE_DATABASE: z.string().min(1).default('analytics'),
    /** Kafka brokers for the order.events ingest consumer. */
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Kafka client id — shows up in broker logs/metrics. */
    KAFKA_CLIENT_ID: z.string().min(1).default('analytics'),
  });
