import { randomUUID } from 'node:crypto';
import { ConflictError } from '@auth/domain/shared/errors';
import { Tenant } from '@auth/domain/tenant/tenant';
import { TENANT_REPOSITORY, type TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { Inject, Injectable } from '@nestjs/common';

export interface CreateTenantCommand {
  name: string;
  slug: string;
  isActive?: boolean;
}

@Injectable()
export class CreateTenantHandler {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository) {}

  async execute(command: CreateTenantCommand): Promise<Tenant> {
    const existing = await this.tenantRepository.findBySlug(command.slug.trim());
    if (existing) {
      throw new ConflictError(`Tenant slug "${command.slug}" is already taken`);
    }

    const tenant = Tenant.create({ id: randomUUID(), ...command });
    return this.tenantRepository.save(tenant);
  }
}
