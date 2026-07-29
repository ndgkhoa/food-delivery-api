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
// Mirrors HttpForwarder's own FORWARD_TIMEOUT_MS — a fast-fail response must
// land far below this, proving the breaker skipped the fetch entirely.
const FORWARD_TIMEOUT_MS = 10_000;

const maybeDescribe = RUN_E2E ? describe : describe.skip;

/**
 * Proves the breaker's fail-fast behaviour against a REAL toggleable upstream
 * (no mocked fetch, no live Keycloak — a locally-generated JWKS mints real
 * RS256 tokens, matching gateway-identity-edge.e2e-spec.ts): a sustained
 * outage trips the catalog breaker to a fast 503, recovery closes it again
 * after CB_RESET_TIMEOUT_MS, and a different service's breaker never opens.
 *
 * Opt-in only (real HTTP servers + real timers) — set RUN_GATEWAY_CB_E2E=1,
 * e.g. `RUN_GATEWAY_CB_E2E=1 pnpm nx e2e gateway-e2e --testFile=circuit-breaker.e2e-spec.ts`.
 */
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

    // search is never toggled down — its breaker must stay closed throughout,
    // proving catalog's outage doesn't leak across services.
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

    // Fire past the volume threshold against the now-down stub: the earliest
    // calls are real connect failures (502, slow-ish TCP refuse); once the
    // breaker opens the remaining calls short-circuit to a fast 503.
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

    // A different service's breaker is unaffected while catalog's is open.
    const searchRes = await request(gateway.url)
      .get('/api/v1/search/restaurants')
      .set('authorization', `Bearer ${token}`);
    expect(searchRes.status).toBe(200);

    // Bring catalog back and wait past the reset timeout for the half-open probe.
    await catalogStub.up();
    await new Promise((resolve) => setTimeout(resolve, RESET_TIMEOUT_MS + 200));

    const recovered = await request(gateway.url)
      .get('/api/v1/catalog/restaurants')
      .set('authorization', `Bearer ${token}`);
    expect(recovered.status).toBe(200);
  }, 30000);
});
