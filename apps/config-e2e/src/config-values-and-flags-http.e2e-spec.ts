/**
 * End-to-end proof of the config service's HTTP surface against REAL
 * infrastructure — no testcontainers, a live compose stack with the config
 * service running:
 *
 *   docker compose -f infra/docker-compose.yml --profile core --profile messaging up -d
 *   nx run config:migration-run
 *   pnpm --filter config serve          # config on :3008
 *   RUN_CONFIG_E2E=1 pnpm nx e2e config-e2e
 *
 * Env override: CONFIG_BASE_URL (default http://localhost:3008/api/v1).
 *
 * Calls the config service DIRECTLY (bypassing the gateway) and stamps the
 * identity headers a verified gateway request would carry — the same
 * approach `media-e2e` uses. Asserts: a tenant override beats the global
 * default; a feature flag toggles; a non-admin write is rejected 403; a
 * tenant-scoped admin cannot write the global default (403, needs
 * platform-admin); a platform-admin can.
 */
const CONFIG_BASE_URL = process.env.CONFIG_BASE_URL ?? 'http://localhost:3008/api/v1';

const tenantA = '99999999-9999-4999-8999-999999999999';

function headersFor(tenantId: string, roles: string[]): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': `user-${tenantId.slice(0, 8)}`,
    'x-roles': roles.join(','),
  };
}

interface ConfigValueResponse {
  key: string;
  value: number;
}
interface FeatureFlagResponse {
  key: string;
  enabled: boolean;
}

const gatedDescribe = process.env.RUN_CONFIG_E2E === '1' ? describe : describe.skip;

gatedDescribe('Config values + feature flags (e2e, compose)', () => {
  it('a tenant override beats the global default', async () => {
    const key = `e2e.value.${Date.now()}`;

    const globalWrite = await fetch(`${CONFIG_BASE_URL}/config/${key}`, {
      method: 'PUT',
      headers: headersFor(tenantA, ['platform-admin']),
      body: JSON.stringify({ value: 1500, global: true }),
    });
    expect(globalWrite.status).toBe(200);

    const readsGlobal = await fetch(`${CONFIG_BASE_URL}/config/${key}`, {
      headers: headersFor(tenantA, []),
    });
    expect(((await readsGlobal.json()) as ConfigValueResponse).value).toBe(1500);

    const tenantWrite = await fetch(`${CONFIG_BASE_URL}/config/${key}`, {
      method: 'PUT',
      headers: headersFor(tenantA, ['admin']),
      body: JSON.stringify({ value: 250 }),
    });
    expect(tenantWrite.status).toBe(200);

    const readsTenant = await fetch(`${CONFIG_BASE_URL}/config/${key}`, {
      headers: headersFor(tenantA, []),
    });
    expect(((await readsTenant.json()) as ConfigValueResponse).value).toBe(250);
  });

  it('toggles a feature flag for the caller tenant', async () => {
    const key = `e2e.flag.${Date.now()}`;

    const write = await fetch(`${CONFIG_BASE_URL}/config/flags/${key}`, {
      method: 'PUT',
      headers: headersFor(tenantA, ['admin']),
      body: JSON.stringify({ enabled: true }),
    });
    expect(write.status).toBe(200);

    const read = await fetch(`${CONFIG_BASE_URL}/config/flags/${key}`, {
      headers: headersFor(tenantA, []),
    });
    expect(((await read.json()) as FeatureFlagResponse).enabled).toBe(true);
  });

  it('rejects a write from a caller with no admin role (403)', async () => {
    const res = await fetch(`${CONFIG_BASE_URL}/config/e2e.rejected`, {
      method: 'PUT',
      headers: headersFor(tenantA, ['customer']),
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a tenant-scoped admin writing the global default (needs platform-admin)', async () => {
    const res = await fetch(`${CONFIG_BASE_URL}/config/e2e.global-rejected`, {
      method: 'PUT',
      headers: headersFor(tenantA, ['admin']),
      body: JSON.stringify({ value: 1, global: true }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a key with neither a tenant nor a global row', async () => {
    const res = await fetch(`${CONFIG_BASE_URL}/config/e2e.never-set.${Date.now()}`, {
      headers: headersFor(tenantA, []),
    });
    expect(res.status).toBe(404);
  });
});
