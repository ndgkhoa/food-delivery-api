import {
  type CreateKeycloakUserInput,
  type KeycloakAdminPort,
} from '@auth/domain/keycloak/keycloak-admin.port';
import { KeycloakAdminError } from '@auth/domain/shared/errors';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ADMIN_CLI_CLIENT_ID = 'admin-cli';
const ADMIN_TOKEN_REALM = 'master';

interface RealmRoleRepresentation {
  id: string;
  name: string;
}

@Injectable()
export class KeycloakAdminHttpAdapter implements KeycloakAdminPort {
  private readonly logger = new Logger(KeycloakAdminHttpAdapter.name);
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
    try {
      await this.assignRealmRole(token, userId, input.role);
    } catch (roleError) {
      await this.compensateDelete(token, userId, roleError);
    }
    return userId;
  }

  async deleteUser(userId: string): Promise<void> {
    const token = await this.authenticate();
    await this.deleteUserRecord(token, userId);
  }

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
        firstName: input.username,
        lastName: input.username,
        enabled: true,
        emailVerified: true,
        requiredActions: [],
        attributes: { tenant_id: [input.tenantId] },
        credentials: [{ type: 'password', value: input.password, temporary: false }],
      }),
    });

    if (response.status === 409) {
      throw new KeycloakAdminError(`User "${input.username}" already exists`, 409);
    }
    if (response.status !== 201) {
      this.logger.error(
        `Keycloak user creation failed (${response.status}): ${await response.text()}`,
      );
      throw new KeycloakAdminError('Upstream identity provider error', 502);
    }

    const location = response.headers.get('location');
    const userId = location?.split('/').pop();
    if (!userId) {
      throw new KeycloakAdminError('Keycloak did not return a created user id', 502);
    }
    return userId;
  }

  private async deleteUserRecord(token: string, userId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok && response.status !== 404) {
      throw new KeycloakAdminError(`Keycloak user deletion failed (${response.status})`, 502);
    }
  }

  private async compensateDelete(token: string, userId: string, cause: unknown): Promise<never> {
    try {
      await this.deleteUserRecord(token, userId);
    } catch (deleteError) {
      this.logger.error(
        `Compensation could not remove orphaned Keycloak user ${userId}. ` +
          `cause=${String(cause)} deleteError=${String(deleteError)}`,
      );
      throw new KeycloakAdminError(
        `Provisioning failed and the orphaned Keycloak user ${userId} could not be removed`,
        502,
      );
    }
    throw cause;
  }

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
