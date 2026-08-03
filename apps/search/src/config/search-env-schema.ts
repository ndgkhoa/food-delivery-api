import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Search service env: the base 12-factor vars minus the DB_* block (the search
 * read model lives in Elasticsearch, not SQL, so there is no Postgres database
 * and no migrations). Adds the ES node URL plus the Kafka coordinates for the
 * `catalog.events` projection consumer. `PORT` defaults to 3004 (gateway 3000,
 * catalog 3001, auth 3002, order 3003) so every service runs locally at once.
 */
export const searchEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3004),
    /** Elasticsearch node URL (dev: security disabled, single node — never exposed via Nginx). */
    ELASTICSEARCH_NODE: z.string().url().default('http://localhost:9200'),
    /** Kafka brokers for the catalog.events projection consumer. */
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Kafka client id — shows up in broker logs/metrics. */
    KAFKA_CLIENT_ID: z.string().min(1).default('search'),
  });
