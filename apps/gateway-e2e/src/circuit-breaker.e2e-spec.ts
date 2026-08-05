import 'reflect-metadata';
import { createTestKeySet, type TestKeySet } from '@food-delivery-api/shared-jwt/testing';
import request from 'supertest';
import { type GatewayHandle, startGateway } from './support/service-harness';
import { ToggleableStubUpstream } from './support/toggleable-stub-upstream';

const RUN_E2E = process.env.RUN_GATEWAY_CB_E2E === '1';
const KEYCLOAK_BASE_URL = 'https://idp.test';
const REALM = 'food-delivery';
const ISSUER = `${KEYCLOAK_BASE_URL}/realms/${REALM}`;
const AUDIENCE = 'food-delivery-api';
const VOLUME_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 300;
const FORWARD_TIMEOUT_MS = 10_000;

const maybeDescribe = RUN_E2E ? describe : describe.skip;

maybeDescribe('Gateway per-downstream circuit breaker (e2e)', () => {
  let keys: TestKeySet;
  let catalogStub: ToggleableStubUpstream;
  let searchStub: ToggleableStubUpstream;
  let gateway: GatewayHandle;
  let token: string;

  beforeAll(async () => {
    keys = await createTestKeySet({ issuer: ISSUER, audience: AUDIENCE });
    catalogStub = new ToggleableStubUpstream();
    searchStub = new ToggleableStubUpstream();
    const catalogUrl = await catalogStub.start();
    const searchUrl = await searchStub.start();

    process.env.SEARCH_SERVICE_URL = searchUrl;
    process.env.CB_ENABLED = 'true';
    process.env.CB_ERROR_THRESHOLD_PERCENT = '1';
    process.env.CB_RESET_TIMEOUT_MS = String(RESET_TIMEOUT_MS);
    process.env.CB_ROLLING_WINDOW_MS = '10000';
    process.env.CB_VOLUME_THRESHOLD = String(VOLUME_THRESHOLD);

    gateway = await startGateway({
      catalogUrl,
      keyResolver: keys.keyResolver,
      keycloakBaseUrl: KEYCLOAK_BASE_URL,
      realm: REALM,
      audience: AUDIENCE,
    });
    token = await keys.sign({ sub: 'user-1', tenantId: 'tenant-1', roles: [] });
  }, 60000);

  afterAll(async () => {
    if (gateway) {
      await gateway.app.close();
    }
    await catalogStub?.stop();
    await searchStub?.stop();
  });

  it('fails fast once the catalog breaker opens, recovers after the reset timeout, and never trips search', async () => {
    await catalogStub.down();

    let lastStatus = 0;
    let lastLatencyMs = 0;
    for (let i = 0; i < VOLUME_THRESHOLD + 2; i += 1) {
      const startedAt = Date.now();
      const res = await request(gateway.url)
        .get('/api/v1/catalog/restaurants')
        .set('authorization', `Bearer ${token}`);
      lastStatus = res.status;
      lastLatencyMs = Date.now() - startedAt;
    }

    expect(lastStatus).toBe(503);
    expect(lastLatencyMs).toBeLessThan(FORWARD_TIMEOUT_MS / 2);

    const searchRes = await request(gateway.url)
      .get('/api/v1/search/restaurants')
      .set('authorization', `Bearer ${token}`);
    expect(searchRes.status).toBe(200);

    await catalogStub.up();
    await new Promise((resolve) => setTimeout(resolve, RESET_TIMEOUT_MS + 200));

    const recovered = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${token}`);
    expect(recovered.status).toBe(200);
  }, 30000);
});
