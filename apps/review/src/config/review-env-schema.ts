import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Review service env: the base 12-factor vars with DB_NAME defaulting to its
 * own database `review`, plus Kafka coordinates for the `order.events`
 * eligibility consumer and the `review.events` outbox relay/producer.
 * `PORT` defaults to 3009 — the next free port after config (3008).
 */
export const reviewEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3009),
  DB_NAME: z.string().min(1).default('review'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('review'),
});
