import type { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';

export interface UserTenantLinkRepository {
  save(link: UserTenantLink): Promise<UserTenantLink>;
  findByKeycloakUserId(keycloakUserId: string): Promise<UserTenantLink | null>;
}

export const USER_TENANT_LINK_REPOSITORY = Symbol('UserTenantLinkRepository');
