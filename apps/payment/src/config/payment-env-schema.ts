import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Payment service env: the base 12-factor vars (incl. DB_* for its OWN `payment`
 * database) plus Kafka wiring, the deterministic stub trigger, the Temporal
 * worker/client wiring, and the webhook HMAC secret. Payment now exposes an HTTP
 * surface (the provider webhook) on `PORT` alongside its Kafka consumer + Temporal
 * worker. `PAYMENT_STUB_FAIL_AT_CENTS` is the total the stub declines (everything
 * else succeeds), so a saga compensation path can be triggered without randomness.
 */
/**
 * The dev-only fallback webhook secret. It ships in the repo, so it is public and
 * MUST never authenticate a real provider — production is rejected if it reaches
 * boot still set to this value (see the refine below).
 */
const DEV_WEBHOOK_SECRET = 'dev-payment-webhook-secret';

export const paymentEnvSchema = baseEnvSchema
  .extend({
    DB_NAME: z.string().min(1).default('payment'),
    /** HTTP port for the provider webhook surface. */
    PORT: z.coerce.number().int().positive().default(3007),
    /** Kafka brokers for the command consumer + reply outbox relay. */
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Kafka client id — shows up in broker logs/metrics. */
    KAFKA_CLIENT_ID: z.string().min(1).default('payment'),
    /** Order total (in cents) the stub deterministically DECLINES; all others succeed. */
    PAYMENT_STUB_FAIL_AT_CENTS: z.coerce.number().int().nonnegative().default(66600),
    /** Temporal frontend gRPC address (host:port) the client + worker connect to. */
    TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
    /** Temporal namespace the charge workflows run in. */
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
    /** Task queue the worker polls and the client targets when starting workflows. */
    TEMPORAL_TASK_QUEUE: z.string().min(1).default('payment-charges'),
    /**
     * Absolute/relative path to the `workflows/` dir Temporal bundles into its
     * deterministic sandbox. Optional — defaults to the source tree under the
     * workspace root; set it for containerized deployments shipping it elsewhere.
     */
    TEMPORAL_WORKFLOWS_PATH: z.string().min(1).optional(),
    /** Shared secret used to HMAC-verify inbound provider webhook callbacks. */
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
