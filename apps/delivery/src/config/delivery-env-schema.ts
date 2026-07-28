import { baseEnvSchema } from '@food-delivery-api/shared-config';
import { z } from 'zod';

/**
 * Delivery service env: the base 12-factor vars minus the DB_* block (delivery
 * keeps no SQL — live driver positions + order→driver assignments live in Redis).
 * Adds the Redis URL (reused `core` instance) for GEO + assignment state and the
 * WebSocket redis-adapter fan-out, the Kafka coordinates for the `order.events`
 * consumer, and the JWT verification config used to authenticate the WebSocket
 * handshake (a WS client connects DIRECT to this service, so it verifies tokens
 * itself instead of relying on the gateway). `PORT` defaults to 3005 (gateway
 * 3000, catalog 3001, auth 3002, order 3003, search 3004).
 */
export const deliveryEnvSchema = baseEnvSchema
  .omit({ DB_HOST: true, DB_PORT: true, DB_USERNAME: true, DB_PASSWORD: true, DB_NAME: true })
  .extend({
    PORT: z.coerce.number().int().positive().default(3005),
    /** Redis connection string for driver GEO positions + assignment state + WS adapter. */
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    /** Kafka brokers for the `order.events` driver-assignment consumer. */
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Kafka client id — shows up in broker logs/metrics. */
    KAFKA_CLIENT_ID: z.string().min(1).default('delivery'),
    /** Per-socket cap on driver location pushes per second (drops excess, never disconnects). */
    DRIVER_LOCATION_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(5),
    /** Default + maximum radius (metres) for the nearby-drivers query and assignment search. */
    NEARBY_RADIUS_M: z.coerce.number().int().positive().default(3000),
    /**
     * Keycloak base URL + realm. The issuer (`<url>/realms/<realm>`) and JWKS
     * endpoint are derived from these so a WS token's `iss` and the key set the
     * service trusts can never drift apart — mirrors the gateway's derivation.
     */
    KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
    KEYCLOAK_REALM: z.string().min(1).default('food-delivery'),
    /** Expected `aud` claim — Keycloak stamps this via the realm's audience mapper. */
    JWT_AUDIENCE: z.string().min(1).default('food-delivery-api'),
    JWT_CLOCK_TOLERANCE_SEC: z.coerce.number().int().nonnegative().default(5),
  });
