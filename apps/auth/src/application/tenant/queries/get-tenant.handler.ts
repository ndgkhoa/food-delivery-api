import { EntityNotFoundError } from '@auth/domain/shared/errors';
import type { Tenant } from '@auth/domain/tenant/tenant';
import { TENANT_REPOSITORY, type TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetTenantHandler {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository) {}

  async execute(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new EntityNotFoundError('Tenant', id);
    }
    return tenant;
  }
}
