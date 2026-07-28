/**
 * Shared coordinates for the compose-based delivery e2e. The ORCHESTRATOR starts
 * `core` + `messaging` (Redis + Kafka) and the `order` + `delivery` services on
 * the host, and points the delivery service's JWT verification at the local test
 * JWKS server this suite serves (see `jwks-server.ts`):
 *
 *   KEYCLOAK_URL=http://localhost:8899  KEYCLOAK_REALM=food-delivery-e2e
 *   JWT_AUDIENCE=food-delivery-api      REDIS_URL / KAFKA_BROKERS as below
 *
 * WS clients connect DIRECT to the delivery port (the gateway only proxies HTTP).
 */
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
// Socket.IO connects over this http(s) origin — the client upgrades to the WS transport itself.
export const DELIVERY_BASE_URL = process.env.DELIVERY_BASE_URL ?? 'http://localhost:3005';

/** Fixed port the local JWKS server binds — must match the delivery service's KEYCLOAK_URL. */
export const JWKS_SERVER_PORT = 8899;
export const KEYCLOAK_REALM = 'food-delivery-e2e';
export const JWT_ISSUER = `http://localhost:${JWKS_SERVER_PORT}/realms/${KEYCLOAK_REALM}`;
export const JWT_AUDIENCE = 'food-delivery-api';

/** Two distinct v4-shaped tenant ids for the isolation scenario. */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

export const ORDER_EVENTS_TOPIC = 'order.events';
