import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

const DEV_WEBHOOK_SECRET = 'dev-payment-webhook-secret';

export const paymentEnvSchema = baseEnvSchema
  .extend({
    DB_NAME: z.string().min(1).default('payment'),
    PORT: z.coerce.number().int().positive().default(3007),
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    KAFKA_CLIENT_ID: z.string().min(1).default('payment'),
    PAYMENT_STUB_FAIL_AT_CENTS: z.coerce.number().int().nonnegative().default(66600),
    TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
    TEMPORAL_TASK_QUEUE: z.string().min(1).default('payment-charges'),
    TEMPORAL_WORKFLOWS_PATH: z.string().min(1).optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().min(1).default(DEV_WEBHOOK_SECRET),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PAYMENT_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message:
          'must be set to a real secret in production — the public dev default would let anyone forge provider callbacks',
      });
    }
  });
