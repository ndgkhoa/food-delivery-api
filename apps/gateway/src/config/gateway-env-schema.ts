import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const gatewayEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3000),
    CATALOG_SERVICE_URL: z.string().url().default('http://localhost:3001'),
    AUTH_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    ORDER_SERVICE_URL: z.string().url().default('http://localhost:3003'),
    SEARCH_SERVICE_URL: z.string().url().default('http://localhost:3004'),
    DELIVERY_SERVICE_URL: z.string().url().default('http://localhost:3005'),
    MEDIA_SERVICE_URL: z.string().url().default('http://localhost:3006'),
    CONFIG_SERVICE_URL: z.string().url().default('http://localhost:3008'),
    REVIEW_SERVICE_URL: z.string().url().default('http://localhost:3009'),
    ANALYTICS_SERVICE_URL: z.string().url().default('http://localhost:3010'),
    KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
    KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
    JWT_AUDIENCE: z.string().min(1).default('food-delivery-api'),
    JWT_CLOCK_TOLERANCE_SEC: z.coerce.number().int().nonnegative().default(5),
    KEYCLOAK_SPA_CLIENT_ID: z.string().min(1).default('food-delivery-spa'),
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    CB_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    CB_ERROR_THRESHOLD_PERCENT: z.coerce.number().int().positive().default(50),
    CB_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    CB_ROLLING_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
    CB_VOLUME_THRESHOLD: z.coerce.number().int().positive().default(5),
  });
