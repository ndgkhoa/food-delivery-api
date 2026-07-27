import { randomUUID } from 'node:crypto';
import {
  KEYCLOAK_ADMIN_PORT,
  type KeycloakAdminPort,
} from '@auth/domain/keycloak/keycloak-admin.port';
import { EntityNotFoundError } from '@auth/domain/shared/errors';
import { assertValidTenantId } from '@auth/domain/shared/uuid';
import { TENANT_REPOSITORY, type TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import {
  USER_TENANT_LINK_REPOSITORY,
  type UserTenantLinkRepository,
} from '@auth/domain/tenant/user-tenant-link.repository';
import { Inject, Injectable } from '@nestjs/common';

export interface ProvisionUserCommand {
  tenantId: string;
  username: string;
  email: string;
  role: string;
  password: string;
}

/**
 * Provisions a Keycloak user for an existing tenant: creates the user (with the
 * validated UUID `tenant_id` attribute + role) via the Keycloak admin port, then
 * records the user↔tenant link in the registry. The Keycloak call sits between
 * two independent DB reads/writes rather than inside a DB transaction — a
 * transaction must never be held open across an external network call.
 */
@Injectable()
export class ProvisionUserHandler {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(USER_TENANT_LINK_REPOSITORY)
    private readonly userTenantLinkRepository: UserTenantLinkRepository,
    @Inject(KEYCLOAK_ADMIN_PORT) private readonly keycloakAdmin: KeycloakAdminPort,
  ) {}

  async execute(command: ProvisionUserCommand): Promise<UserTenantLink> {
    // M-2: refuse to stamp a non-UUID tenant_id onto a Keycloak user, so every
    // token minted for the user later carries a valid tenant claim.
    assertValidTenantId(command.tenantId);

    const tenant = await this.tenantRepository.findById(command.tenantId);
    if (!tenant) {
      throw new EntityNotFoundError('Tenant', command.tenantId);
    }

    const keycloakUserId = await this.keycloakAdmin.createUser({
      tenantId: tenant.id,
      username: command.username,
      email: command.email,
      role: command.role,
      password: command.password,
    });

    const link = UserTenantLink.create({
      id: randomUUID(),
      keycloakUserId,
      tenantId: tenant.id,
      role: command.role,
    });
    return this.userTenantLinkRepository.save(link);
  }
}
