import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const catalogEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_NAME: z.string().min(1).default('catalog'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('catalog'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
});
