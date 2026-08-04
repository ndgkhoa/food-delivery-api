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
const SHORTLIVED_CLIENT_ID = 'food-delivery-shortlived';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Gateway authorization matrix with real Keycloak (e2e)', () => {
  let keycloak: KeycloakHandle;
  let catalog: CatalogHandle;
  let gateway: GatewayHandle;
  let ownerToken: string;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    catalog = await startCatalog();
    gateway = await startGateway({
      catalogUrl: catalog.url,
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
    adminToken = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'admin-user',
      password: 'admin-pass',
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

  it('locks the auth-proxy admin path with no token — GET /auth/tenants (401)', async () => {
    await request(gateway.url).get('/api/v1/auth/tenants').expect(401);
  });

  it('locks the auth-proxy admin path with no token — POST /auth/tenants (401)', async () => {
    await request(gateway.url).post('/api/v1/auth/tenants').send({ name: 'No Auth' }).expect(401);
  });

  it('serves the public health probe without a token (200)', async () => {
    const res = await request(gateway.url).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
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

  it('allows an admin to create a restaurant (201)', async () => {
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Kitchen' })
      .expect(201);
  });

  it('ignores forged identity headers on a customer token — real role wins (403)', async () => {
    await request(gateway.url)
      .post('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${customerToken}`)
      .set('x-roles', 'admin')
      .set('x-tenant-id', '99999999-9999-4999-8999-999999999999')
      .set('x-user-id', 'attacker')
      .send({ name: 'Spoofed Kitchen' })
      .expect(403);
  });

  describe('menu-item write RBAC (nested route)', () => {
    let restaurantId: string;

    beforeAll(async () => {
      const res = await request(gateway.url)
        .post('/api/v1/catalog/restaurants')
        .set('authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Menu Owner Kitchen' })
        .expect(201);
      restaurantId = res.body.id;
    });

    it('forbids a customer from creating a menu item (403)', async () => {
      await request(gateway.url)
        .post(`/api/v1/catalog/restaurants/${restaurantId}/menu-items`)
        .set('authorization', `Bearer ${customerToken}`)
        .send({ name: 'Pho', priceCents: 1299 })
        .expect(403);
    });

    it('allows an owner to create a menu item (201)', async () => {
      await request(gateway.url)
        .post(`/api/v1/catalog/restaurants/${restaurantId}/menu-items`)
        .set('authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Pho', priceCents: 1299 })
        .expect(201);
    });
  });

  it('rejects a real expired Keycloak token (401)', async () => {
    const shortLivedToken = await mintPasswordToken({
      baseUrl: keycloak.baseUrl,
      username: 'customer-user',
      password: 'customer-pass',
      clientId: SHORTLIVED_CLIENT_ID,
    });
    await delay(8000);
    await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${shortLivedToken}`)
      .expect(401);
  }, 20000);
});
