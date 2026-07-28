import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * The gateway is a stateless edge app — it owns no database, so it drops the
 * base DB_* vars and adds the downstream target + JWT verification config.
 * `PORT` defaults to 3000 (catalog uses 3001) so both can run locally.
 */
export const gatewayEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3000),
    /** Base URL of the catalog service the gateway forwards `/api/v1/catalog/*` to. */
    CATALOG_SERVICE_URL: z.string().url().default('http://localhost:3001'),
    /** Base URL of the auth service the gateway forwards `/api/v1/auth/*` to. */
    AUTH_SERVICE_URL: z.string().url().default('http://localhost:3002'),
    /** Base URL of the order service the gateway forwards `/api/v1/orders/*` to. */
    ORDER_SERVICE_URL: z.string().url().default('http://localhost:3003'),
    /** Base URL of the search service the gateway forwards `/api/v1/search/*` to. */
    SEARCH_SERVICE_URL: z.string().url().default('http://localhost:3004'),
    /**
     * Keycloak base URL + realm. The issuer (`<url>/realms/<realm>`) and JWKS
     * endpoint are derived from these, so both stay in lockstep and only the
     * host has to change between environments.
     */
    KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
    KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
    /** Expected `aud` claim — Keycloak stamps this via the realm's audience mapper. */
    JWT_AUDIENCE: z.string().min(1).default('food-delivery-api'),
    JWT_CLOCK_TOLERANCE_SEC: z.coerce.number().int().nonnegative().default(5),
    /**
     * Public PKCE client the session proxy exchanges/rotates tokens against. Same
     * client the SPA logs in with, so a rotated refresh token stays bound to it.
     */
    KEYCLOAK_SPA_CLIENT_ID: z.string().min(1).default('food-delivery-spa'),
    /**
     * Per-identity rate limiting (fixed window in Redis). Disabled in test envs so
     * container-less suites never require Redis and are not throttled; enabled in
     * dev/prod. `enum().transform` instead of `coerce.boolean` because coercion
     * treats the string "false" as truthy.
     */
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
    /** Redis connection string for the rate-limit counter store. */
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
  });
