import 'reflect-metadata';
import { decodeJwt } from 'jose';
import request from 'supertest';
import {
  type KeycloakHandle,
  mintPasswordToken,
  startKeycloak,
  stopKeycloak,
} from './support/keycloak-container';
import {
  type AuthHandle,
  type GatewayHandle,
  startAuth,
  startGateway,
  stopAuth,
} from './support/service-harness';

const REALM = 'food-delivery';
const AUDIENCE = 'food-delivery-api';

/**
 * Full provisioning e2e against a REAL Keycloak, through the gateway:
 *   admin token → gateway → POST /api/v1/auth/tenants (create tenant)
 *               → POST /api/v1/auth/tenants/:id/users (provision owner)
 *   → mint the owner's token by direct grant
 *   → assert the token carries the assigned role + the tenant's valid UUID tenant_id.
 *
 * Proves the M-2 chain end-to-end: the registry's generated tenant UUID becomes
 * the provisioned user's `tenant_id` claim.
 *
 * NOTE: boots Keycloak (~30-60s) + auth's Postgres + the gateway — run it
 * explicitly, e.g. `pnpm nx e2e auth-e2e --testFile=provisioning.e2e-spec.ts`.
 */
describe('Auth provisioning via gateway with real Keycloak (e2e)', () => {
  let keycloak: KeycloakHandle;
  let auth: AuthHandle;
  let gateway: GatewayHandle;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    auth = await startAuth({ keycloakBaseUrl: keycloak.baseUrl, realm: REALM });
    gateway = await startGateway({
      authUrl: auth.url,
      keycloakBaseUrl: keycloak.baseUrl,
      realm: REALM,
      audience: AUDIENCE,
    });

    adminToken = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'admin-user',
      password: 'admin-pass',
    });
    customerToken = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'customer-user',
      password: 'customer-pass',
    });
  }, 300000);

  afterAll(async () => {
    if (gateway) {
      await gateway.app.close();
    }
    if (auth) {
      await stopAuth(auth);
    }
    if (keycloak) {
      await stopKeycloak(keycloak);
    }
  });

  it('rejects tenant creation without a token (401)', async () => {
    await request(gateway.url)
      .post('/api/v1/auth/tenants')
      .send({ name: 'No Auth', slug: 'no-auth' })
      .expect(401);
  });

  it('forbids a non-admin from creating a tenant (403)', async () => {
    await request(gateway.url)
      .post('/api/v1/auth/tenants')
      .set('authorization', `Bearer ${customerToken}`)
      .send({ name: 'Customer Co', slug: 'customer-co' })
      .expect(403);
  });

  it('provisions an owner whose minted token carries the role + valid tenant_id', async () => {
    // 1. Admin creates a tenant.
    const slug = `acme-${Date.now()}`;
    const createRes = await request(gateway.url)
      .post('/api/v1/auth/tenants')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: 'Acme Foods', slug })
      .expect(201);
    const tenantId: string = createRes.body.id;
    expect(tenantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // 2. Admin provisions an owner user under that tenant.
    const username = `owner-${Date.now()}`;
    const password = 'sup3r-secret';
    await request(gateway.url)
      .post(`/api/v1/auth/tenants/${tenantId}/users`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ username, email: `${username}@acme.test`, role: 'restaurant-owner', password })
      .expect(201);

    // 3. The provisioned owner can mint a token, which carries the role + tenant_id.
    const ownerToken = await mintPasswordToken({ baseUrl: keycloak.baseUrl, username, password });
    const claims = decodeJwt(ownerToken);
    expect(claims.tenant_id).toBe(tenantId);
    const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
    expect(realmAccess?.roles ?? []).toContain('restaurant-owner');
  });

  it('lists tenants for an admin (200)', async () => {
    await request(gateway.url)
      .get('/api/v1/auth/tenants')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
