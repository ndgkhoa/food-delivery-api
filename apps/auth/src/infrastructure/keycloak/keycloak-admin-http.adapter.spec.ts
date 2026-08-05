import { randomUUID } from 'node:crypto';
import { KeycloakAdminError } from '@auth/domain/shared/errors';
import { KeycloakAdminHttpAdapter } from '@auth/infrastructure/keycloak/keycloak-admin-http.adapter';
import type { ConfigService } from '@nestjs/config';

function stubConfig(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

interface FakeResponseInit {
  status: number;
  body?: unknown;
  location?: string;
  text?: string;
}

function fakeResponse(init: FakeResponseInit): Response {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    headers: {
      get: (key: string) => (key.toLowerCase() === 'location' ? (init.location ?? null) : null),
    },
    json: async () => init.body,
    text: async () => init.text ?? '',
  } as unknown as Response;
}

const TOKEN_PATH = '/protocol/openid-connect/token';

describe('KeycloakAdminHttpAdapter (fetch stubbed)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let adapter: KeycloakAdminHttpAdapter;

  const input = {
    tenantId: randomUUID(),
    username: 'olivia',
    email: 'olivia@acme.test',
    role: 'customer',
    password: 'sup3r-secret',
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    adapter = new KeycloakAdminHttpAdapter(
      stubConfig({
        KEYCLOAK_URL: 'http://kc.test',
        KEYCLOAK_REALM: 'food-delivery',
        KEYCLOAK_ADMIN: 'admin',
        KEYCLOAK_ADMIN_PASSWORD: 'admin',
      }),
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('surfaces a generic upstream error and never echoes the Keycloak response body', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && options?.method === 'POST') {
        return fakeResponse({ status: 500, text: 'SECRET-internal-keycloak-detail' });
      }
      throw new Error(`unexpected ${options?.method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Upstream identity provider error',
    });
  });

  it('deletes the created user when realm-role assignment fails (create-then-compensate)', async () => {
    const deleteCalls: string[] = [];
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && method === 'POST') {
        return fakeResponse({
          status: 201,
          location: 'http://kc.test/admin/realms/food-delivery/users/kc-123',
        });
      }
      if (url.includes('/roles/') && method === 'GET') {
        return fakeResponse({ status: 200, body: { id: 'role-1', name: 'customer' } });
      }
      if (url.includes('/role-mappings/realm') && method === 'POST') {
        return fakeResponse({ status: 500 });
      }
      if (url.includes('/users/kc-123') && method === 'DELETE') {
        deleteCalls.push(url);
        return fakeResponse({ status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toBeInstanceOf(KeycloakAdminError);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain('/users/kc-123');
  });

  it('treats DELETE 204 and 404 as success (idempotent deleteUser)', async () => {
    for (const status of [204, 404]) {
      fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (url.includes(TOKEN_PATH))
          return fakeResponse({ status: 200, body: { access_token: 't' } });
        if (url.includes('/users/kc-9') && options?.method === 'DELETE') {
          return fakeResponse({ status });
        }
        throw new Error(`unexpected ${options?.method} ${url}`);
      });

      await expect(adapter.deleteUser('kc-9')).resolves.toBeUndefined();
    }
  });

  it('throws a 502 KeycloakAdminError on a genuine deletion failure', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (options?.method === 'DELETE') return fakeResponse({ status: 500 });
      throw new Error(`unexpected ${options?.method} ${url}`);
    });

    await expect(adapter.deleteUser('kc-9')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 KeycloakAdminError when the admin token request itself fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(TOKEN_PATH)) return fakeResponse({ status: 401 });
      throw new Error(`unexpected token request ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Keycloak admin authentication failed (401)',
    });
  });

  it('throws a 409 KeycloakAdminError when the username already exists', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && options?.method === 'POST') {
        return fakeResponse({ status: 409 });
      }
      throw new Error(`unexpected ${options?.method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 409,
      message: `User "${input.username}" already exists`,
    });
  });

  it('throws a 502 KeycloakAdminError when Keycloak omits the Location header on creation', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && options?.method === 'POST') {
        return fakeResponse({ status: 201 });
      }
      throw new Error(`unexpected ${options?.method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Keycloak did not return a created user id',
    });
  });

  it('throws a 400 KeycloakAdminError when the realm role does not exist', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && method === 'POST') {
        return fakeResponse({
          status: 201,
          location: 'http://kc.test/admin/realms/food-delivery/users/kc-404',
        });
      }
      if (url.includes('/roles/') && method === 'GET') {
        return fakeResponse({ status: 404 });
      }
      if (url.includes('/users/kc-404') && method === 'DELETE') {
        return fakeResponse({ status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 400,
      message: `Realm role "${input.role}" does not exist`,
    });
  });

  it('throws a 502 KeycloakAdminError when the realm role lookup fails upstream', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && method === 'POST') {
        return fakeResponse({
          status: 201,
          location: 'http://kc.test/admin/realms/food-delivery/users/kc-500',
        });
      }
      if (url.includes('/roles/') && method === 'GET') {
        return fakeResponse({ status: 503 });
      }
      if (url.includes('/users/kc-500') && method === 'DELETE') {
        return fakeResponse({ status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Keycloak role lookup failed (503)',
    });
  });

  it('creates the user and assigns the realm role end-to-end on the happy path', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && method === 'POST') {
        return fakeResponse({
          status: 201,
          location: 'http://kc.test/admin/realms/food-delivery/users/kc-happy',
        });
      }
      if (url.includes('/roles/') && method === 'GET') {
        return fakeResponse({ status: 200, body: { id: 'role-1', name: 'customer' } });
      }
      if (url.includes('/role-mappings/realm') && method === 'POST') {
        return fakeResponse({ status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(adapter.createUser(input)).resolves.toBe('kc-happy');
  });

  it('surfaces a reconciliation error when role assignment fails and the compensating delete also fails', async () => {
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (url.includes(TOKEN_PATH))
        return fakeResponse({ status: 200, body: { access_token: 't' } });
      if (url.endsWith('/users') && method === 'POST') {
        return fakeResponse({
          status: 201,
          location: 'http://kc.test/admin/realms/food-delivery/users/kc-orphan',
        });
      }
      if (url.includes('/roles/') && method === 'GET') {
        return fakeResponse({ status: 200, body: { id: 'role-1', name: 'customer' } });
      }
      if (url.includes('/role-mappings/realm') && method === 'POST') {
        return fakeResponse({ status: 500 });
      }
      if (url.includes('/users/kc-orphan') && method === 'DELETE') {
        return fakeResponse({ status: 500 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(adapter.createUser(input)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('could not be removed'),
    });
  });
});
