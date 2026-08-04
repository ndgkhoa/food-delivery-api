import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const inventoryEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3011),
  DB_NAME: z.string().min(1).default('inventory'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  INVENTORY_GRPC_URL: z.string().min(1).default('0.0.0.0:50052'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('inventory'),
});
