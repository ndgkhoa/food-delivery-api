import type { PageResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';

export interface TenantRepository {
  save(tenant: Tenant): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findAndCount(pagination: Pagination): Promise<PageResult<Tenant>>;
}

export const TENANT_REPOSITORY = Symbol('TenantRepository');
