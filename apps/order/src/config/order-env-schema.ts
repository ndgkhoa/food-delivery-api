import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Order service env: the base 12-factor vars (incl. DB_* for its OWN `order`
 * database in the shared core Postgres) plus the gRPC endpoints for the two
 * east-west dependencies it calls inline (catalog for menu validation,
 * inventory for reserve/release). Order is HTTP-only — it never opens a gRPC
 * server of its own.
 */
export const orderEnvSchema = baseEnvSchema.extend({
  DB_NAME: z.string().min(1).default('order'),
  /**
   * Streaming read-replica host for the order data source. Unset (the
   * single-node dev default) means no replica is configured — TypeORM's
   * "slave" pool falls back to the master connection, so every read still
   * lands on the one real database and behaviour is unchanged.
   */
  DB_REPLICA_HOST: z.string().min(1).optional(),
  /**
   * Streaming read-replica port. Only consulted when `DB_REPLICA_HOST` is set.
   * Defaults to 5433 — the host port compose maps `postgres-replica` to — so a
   * dev who sets only `DB_REPLICA_HOST=localhost` reaches the replica, not the
   * primary (5432); reads silently hitting the primary would defeat the split.
   */
  DB_REPLICA_PORT: z.coerce.number().int().positive().default(5433),
  PORT: z.coerce.number().int().positive().default(3003),
  /** gRPC endpoint of the catalog service (internal only — never exposed via Nginx). */
  CATALOG_GRPC_URL: z.string().min(1).default('0.0.0.0:50051'),
  /** gRPC endpoint of the inventory service (used by the manual cancel/release path). */
  INVENTORY_GRPC_URL: z.string().min(1).default('0.0.0.0:50052'),
  /** Kafka brokers for the saga producer (outbox relay) + reply consumers. */
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  /** Kafka client id — shows up in broker logs/metrics. */
  KAFKA_CLIENT_ID: z.string().min(1).default('order'),
  /** A saga idle longer than this (ms) in a non-terminal state is reported stranded by the reaper. */
  SAGA_REAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** How often (ms) the stranded-saga reaper sweep runs. */
  SAGA_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  /** Base URL of the config service — PlaceOrderHandler reads the tenant's delivery-fee/VAT/discount tunables from it. */
  CONFIG_SERVICE_URL: z.string().min(1).default('http://localhost:3008'),
  /** config-client's read-through cache TTL (ms) — the self-healing backstop if a `config.events` invalidation is ever missed. */
  CONFIG_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
});
