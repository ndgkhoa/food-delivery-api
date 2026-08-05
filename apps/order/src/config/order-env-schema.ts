import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const orderEnvSchema = baseEnvSchema.extend({
  DB_NAME: z.string().min(1).default('order'),
  DB_REPLICA_HOST: z.string().min(1).optional(),
  DB_REPLICA_PORT: z.coerce.number().int().positive().default(5433),
  PORT: z.coerce.number().int().positive().default(3003),
  CATALOG_GRPC_URL: z.string().min(1).default('0.0.0.0:50051'),
  INVENTORY_GRPC_URL: z.string().min(1).default('0.0.0.0:50052'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('order'),
  SAGA_REAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SAGA_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  SAGA_RECONCILER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  CONFIG_SERVICE_URL: z.string().min(1).default('http://localhost:3008'),
  CONFIG_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
});
