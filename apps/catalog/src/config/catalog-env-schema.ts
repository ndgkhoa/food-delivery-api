import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Catalog service env: the base 12-factor vars with DB_NAME defaulting to its
 * own database `catalog`. Defaulting per service (like auth/inventory/order)
 * means a shared `.env` never has to pin a single global DB_NAME — each service
 * picks its own, so they can all run together via `pnpm dev`.
 */
export const catalogEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_NAME: z.string().min(1).default('catalog'),
  // Kafka for the read-model projection consumer. Debezium (not the app) emits
  // catalog events, so no producer is wired here — only the consumer client.
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('catalog'),
  // The `core`-profile Redis, fronting hot restaurant reads (cache-aside +
  // write-through). Never a hard dependency: a down/unreachable Redis falls
  // back to the Postgres read model transparently.
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
});
