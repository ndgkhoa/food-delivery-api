import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const searchEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3004),
    ELASTICSEARCH_NODE: z.string().url().default('http://localhost:9200'),
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    KAFKA_CLIENT_ID: z.string().min(1).default('search'),
  });
