import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Auth service env: the base 12-factor vars (incl. DB_* for its OWN registry
 * database) plus the Keycloak admin connection the provisioning adapter uses.
 * The registry lives in the shared core Postgres (host port 5432) under its own
 * database name `auth`; PORT defaults to 3002 (gateway 3000, catalog 3001).
 */
export const authEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  DB_NAME: z.string().min(1).default('auth'),
  /** Keycloak base URL — admin token + Admin REST calls are derived from it. */
  KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
  /** Target realm users are provisioned into. */
  KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
  /**
   * Bootstrap admin creds for the master-realm admin-cli direct grant. NO schema
   * default on purpose: this adapter wields master-realm admin power, so a missing
   * value must fail loud at boot rather than silently authenticating as admin/admin.
   * Dev convenience lives in `.env` / `.env.example`, never a schema default.
   */
  KEYCLOAK_ADMIN: z.string().min(1),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1),
});
