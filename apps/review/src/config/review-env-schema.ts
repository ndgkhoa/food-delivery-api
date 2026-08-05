import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const reviewEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3009),
  DB_NAME: z.string().min(1).default('review'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('review'),
});
