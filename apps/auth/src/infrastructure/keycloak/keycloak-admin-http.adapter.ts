import {
  type CreateKeycloakUserInput,
  type KeycloakAdminPort,
} from '@auth/domain/keycloak/keycloak-admin.port';
import { KeycloakAdminError } from '@auth/domain/shared/errors';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Master-realm client used for the admin password grant (Keycloak ships it by default). */
const ADMIN_CLI_CLIENT_ID = 'admin-cli';
const ADMIN_TOKEN_REALM = 'master';

interface RealmRoleRepresentation {
  id: string;
  name: string;
}

/**
 * Implements `KeycloakAdminPort` by calling the Keycloak Admin REST API directly
 * with native `fetch` — chosen over `@keycloak/keycloak-admin-client` to avoid a
 * heavy dependency + ESM/CJS interop under webpack/jest, matching the fetch-based
 * pattern already used elsewhere in the repo. Authenticates with the bootstrap
 * admin creds against the master realm, then provisions users in the target realm.
 */
@Injectable()
export class KeycloakAdminHttpAdapter implements KeycloakAdminPort {
  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('KEYCLOAK_URL').replace(/\/$/, '');
    this.realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    this.adminUsername = config.getOrThrow<string>('KEYCLOAK_ADMIN');
    this.adminPassword = config.getOrThrow<string>('KEYCLOAK_ADMIN_PASSWORD');
  }

  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    const token = await this.authenticate();
    const userId = await this.createUserRecord(token, input);
    await this.assignRealmRole(token, userId, input.role);
    return userId;
  }

  /** Obtains an admin access token via the master-realm direct grant. */
  private async authenticate(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: ADMIN_CLI_CLIENT_ID,
      username: this.adminUsername,
      password: this.adminPassword,
    });
    const response = await fetch(
      `${this.baseUrl}/realms/${ADMIN_TOKEN_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!response.ok) {
      throw new KeycloakAdminError(
        `Keycloak admin authentication failed (${response.status})`,
        502,
      );
    }
    const payload = (await response.json()) as { access_token: string };
    return payload.access_token;
  }

  /**
   * Creates the user with the `tenant_id` attribute + a password credential in
   * one call, then reads the created id from the `Location` header. A 409 means
   * the username/email already exists → surfaced as a client conflict.
   */
  private async createUserRecord(token: string, input: CreateKeycloakUserInput): Promise<string> {
    const response = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        // Keycloak 24+ declarative User Profile marks firstName/lastName required;
        // an admin-created user missing them is "not fully set up" and cannot log in
        // (password grant → invalid_grant). Seed them from the username.
        firstName: input.username,
        lastName: input.username,
        enabled: true,
        emailVerified: true,
        // Belt-and-suspenders: no pending required actions on the fresh account.
        requiredActions: [],
        attributes: { tenant_id: [input.tenantId] },
        credentials: [{ type: 'password', value: input.password, temporary: false }],
      }),
    });

    if (response.status === 409) {
      throw new KeycloakAdminError(`User "${input.username}" already exists`, 409);
    }
    if (response.status !== 201) {
      throw new KeycloakAdminError(
        `Keycloak user creation failed (${response.status}): ${await response.text()}`,
        502,
      );
    }

    const location = response.headers.get('location');
    const userId = location?.split('/').pop();
    if (!userId) {
      throw new KeycloakAdminError('Keycloak did not return a created user id', 502);
    }
    return userId;
  }

  /** Looks up the realm role representation and maps it onto the user. */
  private async assignRealmRole(token: string, userId: string, role: string): Promise<void> {
    const roleResponse = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/roles/${encodeURIComponent(role)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (roleResponse.status === 404) {
      throw new KeycloakAdminError(`Realm role "${role}" does not exist`, 400);
    }
    if (!roleResponse.ok) {
      throw new KeycloakAdminError(`Keycloak role lookup failed (${roleResponse.status})`, 502);
    }
    const roleRep = (await roleResponse.json()) as RealmRoleRepresentation;

    const assignResponse = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/realm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([{ id: roleRep.id, name: roleRep.name }]),
      },
    );
    if (!assignResponse.ok) {
      throw new KeycloakAdminError(
        `Keycloak role assignment failed (${assignResponse.status})`,
        502,
      );
    }
  }
}
