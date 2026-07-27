import { resolve } from 'node:path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// The realm import the compose `auth` profile uses is reused verbatim here, so
// the e2e exercises the exact clients/roles/mappers/users that ship to dev.
const REALM_EXPORT_PATH = resolve(__dirname, '../../../../infra/keycloak/realm-export.json');
const REALM = 'food-delivery';
const SPA_CLIENT_ID = 'food-delivery-spa';

export interface KeycloakHandle {
  container: StartedTestContainer;
  /** e.g. `http://localhost:54321` — used verbatim as issuer base so token `iss` matches. */
  baseUrl: string;
}

/**
 * Boots a throwaway Keycloak (no maintained `@testcontainers/keycloak` package
 * exists, so `GenericContainer` + `--import-realm`) and waits until the realm's
 * OIDC discovery document answers 200. Generous startup budget — cold boot is
 * ~30-60s.
 */
export async function startKeycloak(): Promise<KeycloakHandle> {
  const container = await new GenericContainer('quay.io/keycloak/keycloak:26.7')
    .withExposedPorts(8080)
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
      KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
    })
    .withCopyFilesToContainer([
      { source: REALM_EXPORT_PATH, target: '/opt/keycloak/data/import/realm-export.json' },
    ])
    .withCommand(['start-dev', '--import-realm'])
    .withWaitStrategy(
      Wait.forHttp(`/realms/${REALM}/.well-known/openid-configuration`, 8080).forStatusCode(200),
    )
    .withStartupTimeout(120_000)
    .start();

  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
  return { container, baseUrl };
}

export async function stopKeycloak(handle: KeycloakHandle): Promise<void> {
  await handle.container.stop();
}

/** Full token set from the direct-grant flow (refresh token drives the rotation/logout e2e). */
export interface MintedTokenSet {
  accessToken: string;
  refreshToken: string;
}

/**
 * Mints a real access + refresh token via the direct-access (password) grant.
 * Defaults to the public SPA client; pass `clientId` to mint from another client
 * (e.g. the short-lived client whose 2s token lifespan drives the expiry test).
 */
export async function mintTokenSet(config: {
  baseUrl: string;
  username: string;
  password: string;
  clientId?: string;
}): Promise<MintedTokenSet> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.clientId ?? SPA_CLIENT_ID,
    username: config.username,
    password: config.password,
    scope: 'openid',
  });
  const response = await fetch(`${config.baseUrl}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`Failed to mint token (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token: string; refresh_token: string };
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token };
}

/** Convenience wrapper returning just the access token (authz-matrix e2e). */
export async function mintPasswordToken(config: {
  baseUrl: string;
  username: string;
  password: string;
  clientId?: string;
}): Promise<string> {
  return (await mintTokenSet(config)).accessToken;
}
