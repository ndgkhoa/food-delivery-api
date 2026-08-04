export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
export const DELIVERY_BASE_URL = process.env.DELIVERY_BASE_URL ?? 'http://localhost:3005';

export const JWKS_SERVER_PORT = 8899;
export const KEYCLOAK_REALM = 'food-delivery-e2e';
export const JWT_ISSUER = `http://localhost:${JWKS_SERVER_PORT}/realms/${KEYCLOAK_REALM}`;
export const JWT_AUDIENCE = 'food-delivery-api';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

export const ORDER_EVENTS_TOPIC = 'order.events';
