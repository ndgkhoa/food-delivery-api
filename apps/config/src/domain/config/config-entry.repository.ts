import type { ConfigEntry } from '@config/domain/config/config-entry';

export interface ConfigEntryRepository {
  /** The caller tenant's own override row only (excludes the global default). */
  findTenantEntry(tenantId: string, key: string): Promise<ConfigEntry | null>;
  /** The global default row (`tenant_id IS NULL`). */
  findGlobalEntry(key: string): Promise<ConfigEntry | null>;
  /** Every row visible to a tenant — its own overrides plus every global default. */
  findAllForTenant(tenantId: string): Promise<ConfigEntry[]>;
  /** Inserts a new row, or updates the existing one for the same identity (create-or-update, keyed by `id`). */
  upsert(entry: ConfigEntry): Promise<ConfigEntry>;
}

export const CONFIG_ENTRY_REPOSITORY = Symbol('ConfigEntryRepository');
