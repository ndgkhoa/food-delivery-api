import type { SeedConfig } from './seed-config';

export async function loginPassword(
  config: SeedConfig,
  username: string,
  password: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.keycloakSpaClientId,
    username,
    password,
  });
  const response = await fetch(
    `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Keycloak login for "${username}" failed (${response.status}): ${text}`);
  }
  const payload = JSON.parse(text) as { access_token: string };
  return payload.access_token;
}

export async function getKeycloakAdminToken(config: SeedConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: config.keycloakAdminUsername,
    password: config.keycloakAdminPassword,
  });
  const response = await fetch(
    `${config.keycloakUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Keycloak admin authentication failed (${response.status}): ${text}`);
  }
  const payload = JSON.parse(text) as { access_token: string };
  return payload.access_token;
}

export async function findUserIdByUsername(
  config: SeedConfig,
  adminToken: string,
  username: string,
): Promise<string | null> {
  const url = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}/users?username=${encodeURIComponent(username)}&exact=true`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${adminToken}` } });
  if (!response.ok) {
    throw new Error(`Keycloak user lookup for "${username}" failed (${response.status})`);
  }
  const users = (await response.json()) as Array<{ id: string; username: string }>;
  return users.find((user) => user.username === username)?.id ?? null;
}

export async function deleteKeycloakUser(
  config: SeedConfig,
  adminToken: string,
  userId: string,
): Promise<void> {
  const response = await fetch(
    `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${adminToken}` } },
  );
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Keycloak user deletion for "${userId}" failed (${response.status}): ${text}`);
  }
}
