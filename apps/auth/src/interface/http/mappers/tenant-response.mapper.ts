import type { Tenant } from '@auth/domain/tenant/tenant';
import type { TenantResponse } from '@auth/interface/http/dto/tenant.response';

export class TenantResponseMapper {
  static toResponse(tenant: Tenant): TenantResponse {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }
}
