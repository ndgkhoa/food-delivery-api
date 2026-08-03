import 'reflect-metadata';
import request from 'supertest';
import {
  type KeycloakHandle,
  mintTokenSet,
  startKeycloak,
  stopKeycloak,
} from './support/keycloak-container';
import { type GatewayHandle, startGateway } from './support/service-harness';

const REALM = 'food-delivery';
const AUDIENCE = 'food-delivery-api';
// Session routes never forward to catalog, so a placeholder base URL is fine.
const CATALOG_PLACEHOLDER_URL = 'http://localhost:1';

/**
 * Session proxy against a REAL Keycloak: refresh-token rotation + backchannel
 * logout. The realm export enables `revokeRefreshToken` + `refreshTokenMaxReuse:0`,
 * so a rotated (or logged-out) refresh token is invalidated on reuse.
 *
 * NOTE: boots a Keycloak container (~30-60s) — run explicitly, e.g.
 * `pnpm nx e2e gateway-e2e --testFile=auth-session.e2e-spec.ts`.
 */
describe('Gateway auth session proxy with real Keycloak (e2e)', () => {
  let keycloak: KeycloakHandle;
  let gateway: GatewayHandle;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    gateway = await startGateway({
      catalogUrl: CATALOG_PLACEHOLDER_URL,
      keycloakBaseUrl: keycloak.baseUrl,
      realm: REALM,
      audience: AUDIENCE,
    });
  }, 240000);

  afterAll(async () => {
    if (gateway) {
      await gateway.app.close();
    }
    if (keycloak) {
      await stopKeycloak(keycloak);
    }
  });

  const mintRefresh = (): Promise<{ accessToken: string; refreshToken: string }> =>
    mintTokenSet({
      baseUrl: keycloak.baseUrl,
      username: 'customer-user',
      password: 'customer-pass',
    });

  it('rotates a refresh token and invalidates the old one on reuse', async () => {
    const { refreshToken } = await mintRefresh();

    const rotated = await request(gateway.url)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(rotated.body.access_token).toBeDefined();
    expect(rotated.body.refresh_token).toBeDefined();
    expect(rotated.body.refresh_token).not.toBe(refreshToken);

    // Reusing the OLD refresh token is rejected (rotation + max-reuse 0 → 401).
    await request(gateway.url).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('revokes the session on logout so the refresh token no longer works', async () => {
    const { refreshToken } = await mintRefresh();

    await request(gateway.url).post('/api/v1/auth/logout').send({ refreshToken }).expect(204);

    await request(gateway.url).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('rejects a token exchange with a bogus authorization code (401)', async () => {
    await request(gateway.url)
      .post('/api/v1/auth/token')
      .send({
        code: 'not-a-real-code',
        codeVerifier: 'x'.repeat(43),
        redirectUri: 'http://localhost/callback',
      })
      .expect(401);
  });
});
