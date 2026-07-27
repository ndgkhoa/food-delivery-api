import 'reflect-metadata';
import { truncateCatalogTables } from '@catalog/testing/catalog-test-database';
import {
  createTestKeySet,
  TEST_TENANT_ID,
  type TestKeySet,
} from '@food-delivery-api/shared-auth/testing';
import request from 'supertest';
import {
  type CatalogHandle,
  type GatewayHandle,
  startCatalog,
  startGateway,
  stopCatalog,
} from './support/service-harness';

const ISSUER = 'https://idp.test/realms/food-delivery';
const AUDIENCE = 'food-delivery-api';
const TENANT_A = TEST_TENANT_ID;
const TENANT_B = '44444444-4444-4444-8444-444444444444';

/**
 * End-to-end proof of the identity edge: client → gateway (JWT verify) →
 * catalog. No Keycloak — the gateway's remote JWKS resolver is replaced with a
 * locally-generated key set so we can mint real RS256 tokens.
 */
describe('Gateway identity edge (e2e)', () => {
  let keys: TestKeySet;
  let catalog: CatalogHandle;
  let gateway: GatewayHandle;

  beforeAll(async () => {
    keys = await createTestKeySet({ issuer: ISSUER, audience: AUDIENCE });
    catalog = await startCatalog();
    gateway = await startGateway({
      catalogUrl: catalog.url,
      keyResolver: keys.keyResolver,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }, 120000);

  afterAll(async () => {
    if (gateway) {
      await gateway.app.close();
    }
    if (catalog) {
      await stopCatalog(catalog);
    }
  });

  afterEach(async () => {
    await truncateCatalogTables(catalog.db.dataSource);
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(gateway.url).get('/api/v1/catalog/restaurants').expect(401);
  });

  it('proxies an authenticated request to catalog and returns 200', async () => {
    const token = await keys.sign({ sub: 'owner-1', tenantId: TENANT_A });

    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Pho 24' })
      .expect(201);

    const listRes = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.data).toHaveLength(1);
  });

  it('scopes tenancy to the token claim and ignores a spoofed x-tenant-id header', async () => {
    const tokenA = await keys.sign({ sub: 'owner-a', tenantId: TENANT_A });
    const tokenB = await keys.sign({ sub: 'owner-b', tenantId: TENANT_B });

    // Client tries to smuggle tenant B via a raw header while authenticating as tenant A.
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${tokenA}`)
      .set('x-tenant-id', TENANT_B)
      .send({ name: 'Tenant A Kitchen' })
      .expect(201);

    // Tenant B sees nothing — the spoofed header was ignored; the token claim won.
    const bList = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(bList.body.data).toHaveLength(0);

    // Tenant A sees exactly the record it created.
    const aList = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(aList.body.data).toHaveLength(1);
  });
});
