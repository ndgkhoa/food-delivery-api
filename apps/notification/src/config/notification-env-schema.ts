import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const notificationEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3012),
  DB_NAME: z.string().min(1).default('notification'),
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('notification'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().min(1).default('notifications@food-delivery.test'),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  NOTIFY_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
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
