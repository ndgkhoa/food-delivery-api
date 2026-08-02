import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Notification service env: the base 12-factor vars (incl. DB_* for its OWN
 * `notification` database) plus Kafka wiring for the `order.events` consumer,
 * the BullMQ Redis connection, SMTP coordinates for the Mailpit email channel,
 * the per-channel enable flags, and the retry/backoff policy shared by the
 * BullMQ producer (attempts/backoff) and the failure handler (exhaustion
 * check). Otherwise headless (no public API) — `PORT` backs only the minimal
 * HTTP listener added for the k8s liveness/readiness probe
 * (`GET /api/v1/health`); defaults to 3012, the next free port after
 * inventory (3011).
 */
export const notificationEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3012),
  DB_NAME: z.string().min(1).default('notification'),
  /** Kafka brokers the order.events consumer connects to. */
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  /** Kafka client id — shows up in broker logs/metrics. */
  KAFKA_CLIENT_ID: z.string().min(1).default('notification'),
  /** Redis connection string backing the BullMQ per-channel queues + workers. */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Mailpit SMTP host the email channel connects to (dev inbox catcher). */
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  /** Envelope sender address stamped on every outgoing email. */
  MAIL_FROM: z.string().min(1).default('notifications@food-delivery.test'),
  /** Attempts before a channel send is exhausted (DEAD row + parked to notify-dlq). */
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Base delay (ms) of the exponential backoff between send retries. */
  NOTIFY_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
  /** Channel enable flags — which channels get a row + job per dispatched event. */
  NOTIFY_EMAIL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  NOTIFY_SMS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  NOTIFY_PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
