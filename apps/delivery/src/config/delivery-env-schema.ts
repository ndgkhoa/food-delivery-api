import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const deliveryEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3005),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    KAFKA_CLIENT_ID: z.string().min(1).default('delivery'),
    DRIVER_LOCATION_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(5),
    NEARBY_RADIUS_M: z.coerce.number().int().positive().default(3000),
    KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
    KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
    JWT_AUDIENCE: z.string().min(1).default('food-delivery-api'),
    JWT_CLOCK_TOLERANCE_SEC: z.coerce.number().int().nonnegative().default(5),
  });
