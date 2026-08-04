import {
  CONFIG_ENTRY_REPOSITORY,
  type ConfigEntryRepository,
} from '@config/domain/config/config-entry.repository';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

export interface ConfigValueListItem {
  key: string;
  value: number;
  scope: 'tenant' | 'global';
}

@Injectable()
export class ListConfigValuesHandler {
  constructor(
    @Inject(CONFIG_ENTRY_REPOSITORY) private readonly repository: ConfigEntryRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(): Promise<ConfigValueListItem[]> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const entries = await this.repository.findAllForTenant(tenantId);

    const byKey = new Map<string, ConfigValueListItem>();
    for (const entry of entries) {
      const scope: 'tenant' | 'global' = entry.tenantId === null ? 'global' : 'tenant';
      const existing = byKey.get(entry.key);
      if (!existing || scope === 'tenant') {
        byKey.set(entry.key, { key: entry.key, value: entry.value, scope });
      }
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}
