import type { ConfigEntry } from '@config/domain/config/config-entry';

export interface ConfigEntryRepository {
  findTenantEntry(tenantId: string, key: string): Promise<ConfigEntry | null>;
  findGlobalEntry(key: string): Promise<ConfigEntry | null>;
  findAllForTenant(tenantId: string): Promise<ConfigEntry[]>;
  upsert(entry: ConfigEntry): Promise<ConfigEntry>;
}

export const CONFIG_ENTRY_REPOSITORY = Symbol('ConfigEntryRepository');
