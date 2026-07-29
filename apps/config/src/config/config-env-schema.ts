import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Config service env: the base 12-factor vars (incl. DB_* — config owns its
 * own Postgres database `config`) plus Kafka producer coordinates for the
 * `config.events` change notifications. `PORT` defaults to 3008 (gateway
 * 3000, catalog 3001, auth 3002, order 3003, search 3004, delivery 3005,
 * media 3006, payment 3007).
 */
export const configEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3008),
  DB_NAME: z.string().min(1).default('config'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('config'),
});
