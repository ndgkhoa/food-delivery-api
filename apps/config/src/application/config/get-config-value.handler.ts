import {
  CONFIG_ENTRY_REPOSITORY,
  type ConfigEntryRepository,
} from '@config/domain/config/config-entry.repository';
import { resolveConfigValue } from '@config/domain/config/config-resolution';
import { ConfigEntryNotFoundError } from '@config/domain/shared/errors';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetConfigValueHandler {
  constructor(
    @Inject(CONFIG_ENTRY_REPOSITORY) private readonly repository: ConfigEntryRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(key: string): Promise<number> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const [tenantEntry, globalEntry] = await Promise.all([
      this.repository.findTenantEntry(tenantId, key),
      this.repository.findGlobalEntry(key),
    ]);

    const value = resolveConfigValue(tenantEntry, globalEntry);
    if (value === undefined) {
      throw new ConfigEntryNotFoundError(key);
    }
    return value;
  }
}
