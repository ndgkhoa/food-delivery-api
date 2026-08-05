import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

export const authEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  DB_NAME: z.string().min(1).default('auth'),
  KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
  KEYCLOAK_ADMIN: z.string().min(1),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1),
});
