import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Order service env: the base 12-factor vars (incl. DB_* for its OWN `order`
 * database in the shared core Postgres) plus the gRPC endpoints for the two
 * east-west dependencies it calls inline (catalog for menu validation,
 * inventory for reserve/release). Order is HTTP-only — it never opens a gRPC
 * server of its own.
 */
export const orderEnvSchema = baseEnvSchema.extend({
  DB_NAME: z.string().min(1).default('order'),
  PORT: z.coerce.number().int().positive().default(3003),
  /** gRPC endpoint of the catalog service (internal only — never exposed via Nginx). */
  CATALOG_GRPC_URL: z.string().min(1).default('0.0.0.0:50051'),
  /** gRPC endpoint of the inventory service (internal only — never exposed via Nginx). */
  INVENTORY_GRPC_URL: z.string().min(1).default('0.0.0.0:50052'),
});
