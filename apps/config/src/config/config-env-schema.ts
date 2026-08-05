import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const configEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3008),
  DB_NAME: z.string().min(1).default('config'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('config'),
});
