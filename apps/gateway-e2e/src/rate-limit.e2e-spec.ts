import 'reflect-metadata';
import request from 'supertest';
import {
  type KeycloakHandle,
  mintPasswordToken,
  startKeycloak,
  stopKeycloak,
} from './support/keycloak-container';
import { type RedisHandle, startRedis, stopRedis } from './support/redis-container';
import {
  type CatalogHandle,
  type GatewayHandle,
  startCatalog,
  startGateway,
  stopCatalog,
} from './support/service-harness';

const REALM = 'food-delivery';
const AUDIENCE = 'food-delivery-api';
const MAX = 3;

/**
 * Rate-limit trip against a REAL Keycloak + Redis: an authenticated caller is
 * keyed by its verified `sub`, so once it exceeds the per-window threshold the
 * gateway returns 429 + Retry-After BEFORE forwarding to catalog.
 *
 * NOTE: boots Keycloak (~30-60s) + Redis + catalog's Postgres — run explicitly,
 * e.g. `pnpm nx e2e gateway-e2e --testFile=rate-limit.e2e-spec.ts`.
 */
describe('Gateway per-identity rate limiting (e2e)', () => {
  let keycloak: KeycloakHandle;
  let redis: RedisHandle;
  let catalog: CatalogHandle;
  let gateway: GatewayHandle;
  let token: string;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    redis = await startRedis();
    catalog = await startCatalog();
    gateway = await startGateway({
      catalogUrl: catalog.url,
      keycloakBaseUrl: keycloak.baseUrl,
      realm: REALM,
      audience: AUDIENCE,
      rateLimit: { max: MAX, windowSec: 60, redisUrl: redis.url },
    });
    token = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'customer-user',
      password: 'customer-pass',
    });
  }, 240000);

  afterAll(async () => {
    if (gateway) {
      await gateway.app.close();
    }
    if (catalog) {
      await stopCatalog(catalog);
    }
    if (redis) {
      await stopRedis(redis);
    }
    if (keycloak) {
      await stopKeycloak(keycloak);
    }
  });

  it('allows requests under the limit then returns 429 with Retry-After', async () => {
    for (let i = 0; i < MAX; i += 1) {
      await request(gateway.url)
        .get('/api/v1/catalog/restaurants')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
    }

    const overLimit = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${token}`);

    expect(overLimit.status).toBe(429);
    expect(overLimit.headers['retry-after']).toBeDefined();
    expect(Number(overLimit.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('trips 429 on a public IP-keyed route from one IP (unauthenticated /auth/refresh)', async () => {
    // Public session route → no `sub`, so it buckets by client IP (`rl:ip:*`).
    // The invalid refresh token is irrelevant: the guard counts each request
    // BEFORE the controller runs, so a single IP hammering past `max` trips 429.
    for (let i = 0; i < MAX; i += 1) {
      await request(gateway.url)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });
    }

    const overLimit = await request(gateway.url)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(overLimit.status).toBe(429);
    expect(overLimit.headers['retry-after']).toBeDefined();
    expect(Number(overLimit.headers['retry-after'])).toBeGreaterThan(0);
  });
});
