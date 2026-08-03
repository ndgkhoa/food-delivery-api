import type { PaginatedResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';
import { TENANT_REPOSITORY, type TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Lists tenants platform-wide (not caller-tenant-scoped): the registry admin
 * API is operated by platform admins who manage every tenant, so there is no
 * tenant-context filter here — access is gated by `@Roles('admin')` at the edge.
 */
@Injectable()
export class ListTenantsHandler {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository) {}

  async execute(pagination: Pagination): Promise<PaginatedResult<Tenant>> {
    const { data, total } = await this.tenantRepository.findAndCount(pagination);
    return { data, total, page: pagination.page, limit: pagination.limit };
  }
}
