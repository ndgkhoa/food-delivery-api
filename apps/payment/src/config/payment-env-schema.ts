import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Payment service env: the base 12-factor vars (incl. DB_* for its OWN `payment`
 * database) plus Kafka wiring and the deterministic stub trigger. Payment is a
 * Kafka-only worker — no HTTP or gRPC surface. `PAYMENT_STUB_FAIL_AT_CENTS` is
 * the total that the stub declines (everything else succeeds), so a saga
 * compensation path can be triggered without randomness.
 */
export const paymentEnvSchema = baseEnvSchema.extend({
  DB_NAME: z.string().min(1).default('payment'),
  /** Kafka brokers for the command consumer + reply outbox relay. */
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  /** Kafka client id — shows up in broker logs/metrics. */
  KAFKA_CLIENT_ID: z.string().min(1).default('payment'),
  /** Order total (in cents) the stub deterministically DECLINES; all others succeed. */
  PAYMENT_STUB_FAIL_AT_CENTS: z.coerce.number().int().nonnegative().default(66600),
});
