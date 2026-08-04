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
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface ProvisionUserCommand {
  tenantId: string;
  username: string;
  email: string;
  role: string;
  password: string;
}

@Injectable()
export class ProvisionUserHandler {
  private readonly logger = new Logger(ProvisionUserHandler.name);

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
    @Inject(USER_TENANT_LINK_REPOSITORY)
    private readonly userTenantLinkRepository: UserTenantLinkRepository,
    @Inject(KEYCLOAK_ADMIN_PORT) private readonly keycloakAdmin: KeycloakAdminPort,
  ) {}

  async execute(command: ProvisionUserCommand): Promise<UserTenantLink> {
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

    try {
      const link = UserTenantLink.create({
        id: randomUUID(),
        keycloakUserId,
        tenantId: tenant.id,
        role: command.role,
      });
      return await this.userTenantLinkRepository.save(link);
    } catch (linkError) {
      return await this.compensate(keycloakUserId, linkError);
    }
  }

  private async compensate(keycloakUserId: string, cause: unknown): Promise<never> {
    try {
      await this.keycloakAdmin.deleteUser(keycloakUserId);
    } catch (deleteError) {
      this.logger.error(
        `Registry write failed AND compensation could not remove Keycloak user ` +
          `${keycloakUserId}. cause=${String(cause)} deleteError=${String(deleteError)}`,
      );
      throw new Error(
        `User provisioning failed and the orphaned Keycloak user ${keycloakUserId} ` +
          `could not be removed; manual reconciliation required`,
      );
    }
    this.logger.warn(
      `Registry write failed; compensated by deleting Keycloak user ${keycloakUserId}`,
    );
    throw cause;
  }
}
