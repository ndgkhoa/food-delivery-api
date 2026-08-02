import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Inventory service env: the base 12-factor vars (incl. DB_* for its OWN
 * `inventory` database in the shared core Postgres) plus the Redis URL for the
 * distributed lock and the gRPC bind address. Inventory's primary surface is
 * gRPC; `PORT` backs a minimal hybrid HTTP listener that exists solely for the
 * k8s liveness/readiness probe (`GET /api/v1/health`) — defaults to 3011, the
 * next free port after analytics (3010).
 */
export const inventoryEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3011),
  DB_NAME: z.string().min(1).default('inventory'),
  /** ioredis connection for the reserve/release distributed lock. */
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /** gRPC bind address (internal only — never exposed via Nginx). */
  INVENTORY_GRPC_URL: z.string().min(1).default('0.0.0.0:50052'),
  /** Kafka brokers for the command consumer + reply outbox relay. */
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  /** Kafka client id — shows up in broker logs/metrics. */
  KAFKA_CLIENT_ID: z.string().min(1).default('inventory'),
});
