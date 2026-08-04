import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { KeycloakAdminHttpAdapter } from '@auth/infrastructure/keycloak/keycloak-admin-http.adapter';
import type { ConfigService } from '@nestjs/config';
import { decodeJwt } from 'jose';
import {
  type KeycloakHandle,
  mintPasswordToken,
  startKeycloak,
  stopKeycloak,
} from './support/keycloak-container';

const REALM = 'food-delivery';

function stubConfig(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`missing config ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService;
}

describe('KeycloakAdminHttpAdapter against real Keycloak (e2e)', () => {
  let keycloak: KeycloakHandle;
  let adapter: KeycloakAdminHttpAdapter;

  beforeAll(async () => {
    keycloak = await startKeycloak();
    adapter = new KeycloakAdminHttpAdapter(
      stubConfig({
        KEYCLOAK_URL: keycloak.baseUrl,
        KEYCLOAK_REALM: REALM,
        KEYCLOAK_ADMIN: 'admin',
        KEYCLOAK_ADMIN_PASSWORD: 'admin',
      }),
    );
  }, 240000);

  afterAll(async () => {
    if (keycloak) {
      await stopKeycloak(keycloak);
    }
  });

  it('creates a user with a valid UUID tenant_id + role, provable via the minted token', async () => {
    const tenantId = randomUUID();
    const username = `owner-${Date.now()}`;
    const password = 'sup3r-secret';

    const userId = await adapter.createUser({
      tenantId,
      username,
      email: `${username}@acme.test`,
      role: 'restaurant-owner',
      password,
    });
    expect(userId).toBeTruthy();

    const token = await mintPasswordToken({ baseUrl: keycloak.baseUrl, username, password });
    const claims = decodeJwt(token);
    expect(claims.tenant_id).toBe(tenantId);
    const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
    expect(realmAccess?.roles ?? []).toContain('restaurant-owner');
  });

  it('rejects a duplicate username with a 409-mapped error', async () => {
    const username = `dup-${Date.now()}`;
    const base = {
      tenantId: randomUUID(),
      username,
      email: `${username}@acme.test`,
      role: 'customer',
      password: 'sup3r-secret',
    };
    await adapter.createUser(base);
    await expect(adapter.createUser(base)).rejects.toMatchObject({ statusCode: 409 });
  });
});
