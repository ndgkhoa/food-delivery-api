import { KeycloakOidcClient } from '@gateway/session/keycloak-oidc.client';
import type { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CONFIG = {
  KEYCLOAK_URL: 'http://keycloak:8080',
  KEYCLOAK_REALM: 'food-delivery',
  KEYCLOAK_SPA_CLIENT_ID: 'food-delivery-spa',
};
const TOKEN_URL = 'http://keycloak:8080/realms/food-delivery/protocol/openid-connect/token';
const LOGOUT_URL = 'http://keycloak:8080/realms/food-delivery/protocol/openid-connect/logout';

function configStub(): ConfigService {
  return { getOrThrow: (key: string) => (CONFIG as Record<string, string>)[key] } as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function bodyOf(mock: jest.Mock): URLSearchParams {
  return mock.mock.calls[0][1].body as URLSearchParams;
}

describe('KeycloakOidcClient', () => {
  let client: KeycloakOidcClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    client = new KeycloakOidcClient(configStub());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exchanges an authorization code + PKCE verifier for tokens', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a', refresh_token: 'r' }));

    const tokens = await client.exchangeCode({
      code: 'the-code',
      codeVerifier: 'the-verifier',
      redirectUri: 'http://localhost/callback',
    });

    expect(tokens).toEqual({ access_token: 'a', refresh_token: 'r' });
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({ method: 'POST' }));
    const body = bodyOf(fetchMock);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('redirect_uri')).toBe('http://localhost/callback');
    expect(body.get('client_id')).toBe('food-delivery-spa');
  });

  it('rotates a refresh token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' }));

    await client.refresh('old-refresh');

    const body = bodyOf(fetchMock);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
  });

  it('maps invalid_grant (reused/expired refresh) to 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    try {
      await client.refresh('reused-refresh');
      fail('expected a 401');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(401);
    }
  });

  it('maps other OAuth errors to 400', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_request' }));
    try {
      await client.refresh('x');
      fail('expected a 400');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(400);
    }
  });

  it('posts client_id + refresh_token to the logout endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204, {}));

    await client.logout('the-refresh');

    expect(fetchMock).toHaveBeenCalledWith(LOGOUT_URL, expect.objectContaining({ method: 'POST' }));
    const body = bodyOf(fetchMock);
    expect(body.get('client_id')).toBe('food-delivery-spa');
    expect(body.get('refresh_token')).toBe('the-refresh');
  });

  it('surfaces a failed logout as 502', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    try {
      await client.logout('the-refresh');
      fail('expected a 502');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(502);
    }
  });
});
