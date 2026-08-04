import type { PaginatedResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';
import { TENANT_REPOSITORY, type TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ListTenantsHandler {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository) {}

  async execute(pagination: Pagination): Promise<PaginatedResult<Tenant>> {
    const { data, total } = await this.tenantRepository.findAndCount(pagination);
    return { data, total, page: pagination.page, limit: pagination.limit };
  }
}
