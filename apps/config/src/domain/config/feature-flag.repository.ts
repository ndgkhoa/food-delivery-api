import type { FeatureFlag } from '@config/domain/config/feature-flag';

export interface FeatureFlagRepository {
  /** The caller tenant's own override row only (excludes the global default). */
  findTenantFlag(tenantId: string, key: string): Promise<FeatureFlag | null>;
  /** The global default row (`tenant_id IS NULL`). */
  findGlobalFlag(key: string): Promise<FeatureFlag | null>;
  /** Inserts a new row, or updates the existing one for the same identity (create-or-update, keyed by `id`). */
  upsert(flag: FeatureFlag): Promise<FeatureFlag>;
}

export const FEATURE_FLAG_REPOSITORY = Symbol('FeatureFlagRepository');
