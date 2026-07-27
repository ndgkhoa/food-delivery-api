import 'reflect-metadata';
import request from 'supertest';
import {
  type KeycloakHandle,
  mintPasswordToken,
  startKeycloak,
  stopKeycloak,
} from './support/keycloak-container';
import {
  type CatalogHandle,
  type GatewayHandle,
  startCatalog,
  startGateway,
  stopCatalog,
} from './support/service-harness';

const REALM = 'food-delivery';
const AUDIENCE = 'food-delivery-api';

/**
 * Authorization matrix against a REAL Keycloak: tokens are minted by password
 * grant for the seeded owner + customer users, and every request goes through
 * the gateway (live JWKS verification) to catalog (service-enforced RBAC).
 *
 * NOTE: boots a Keycloak container (~30-60s) plus catalog's Postgres — run it
 * explicitly, e.g. `pnpm nx e2e gateway-e2e --testFile=authz-matrix.e2e-spec.ts`.
 */
describe('Gateway authorization matrix with real Keycloak (e2e)', () => {
  let keycloak: KeycloakHandle;
  let catalog: CatalogHandle;
  let gateway: GatewayHandle;
  let ownerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    catalog = await startCatalog();
    gateway = await startGateway({
      catalogUrl: catalog.url,
      // No keyResolver → the gateway fetches JWKS from this real Keycloak.
      keycloakBaseUrl: keycloak.baseUrl,
      realm: REALM,
      audience: AUDIENCE,
    });

    ownerToken = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'owner-user',
      password: 'owner-pass',
    });
    customerToken = await mintPasswordToken({
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
    if (keycloak) {
      await stopKeycloak(keycloak);
    }
  });

  it('rejects a write with no token (401)', async () => {
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .send({ name: 'No Auth' })
      .expect(401);
  });

  it('forbids a customer from creating a restaurant (403)', async () => {
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${customerToken}`)
      .send({ name: 'Customer Kitchen' })
      .expect(403);
  });

  it('allows an owner to create a restaurant (201)', async () => {
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Owner Kitchen' })
      .expect(201);
  });

  it('allows a customer to read the restaurant list (200)', async () => {
    await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200);
  });
});
