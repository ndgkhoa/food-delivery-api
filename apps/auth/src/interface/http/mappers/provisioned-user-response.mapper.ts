import type { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import type { ProvisionedUserResponse } from '@auth/interface/http/dto/provisioned-user.response';

export class ProvisionedUserResponseMapper {
  static toResponse(link: UserTenantLink): ProvisionedUserResponse {
    return {
      id: link.id,
      keycloakUserId: link.keycloakUserId,
      tenantId: link.tenantId,
      role: link.role,
      createdAt: link.createdAt,
    };
  }
}
