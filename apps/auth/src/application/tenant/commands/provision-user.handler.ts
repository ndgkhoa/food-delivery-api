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

/**
 * Provisions a Keycloak user for an existing tenant: creates the user (with the
 * validated UUID `tenant_id` attribute + role) via the Keycloak admin port, then
 * records the user↔tenant link in the registry. The Keycloak call sits between
 * two independent DB reads/writes rather than inside a DB transaction — a
 * transaction must never be held open across an external network call.
 *
 * Keycloak and the local registry are separate systems with no shared
 * transaction, so this is create-then-compensate, not distributed-atomic: if the
 * registry write fails after the Keycloak user is created, the just-created user
 * is deleted (best-effort) so a caller never sees a login-capable identity that
 * is absent from the registry. A duplicate username surfaces as a clear 409
 * (KeycloakAdminError) rather than being reconciled — with compensation in place
 * a 409 reliably means the username is genuinely taken, so retry after removing
 * the conflicting user is safe. Full transactional provisioning (Saga/Outbox) is
 * deferred backlog.
 */
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

    // The Keycloak user now exists. The registry write below is a second,
    // independent step; on failure the user is orphaned (login-capable, absent
    // from the registry, retry blocked by Keycloak's 409). Compensate by deleting
    // it so the operation is all-or-nothing to the caller.
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

  /** Best-effort delete of the just-created user; surfaces both errors if it fails. */
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
