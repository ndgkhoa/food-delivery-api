import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const analyticsEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3010),
    CLICKHOUSE_URL: z.string().url().default('http://localhost:8123'),
    CLICKHOUSE_USER: z.string().min(1).default('default'),
    CLICKHOUSE_PASSWORD: z.string().default(''),
    CLICKHOUSE_DATABASE: z.string().min(1).default('analytics'),
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    KAFKA_CLIENT_ID: z.string().min(1).default('analytics'),
  });
