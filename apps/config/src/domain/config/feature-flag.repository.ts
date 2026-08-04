import type { FeatureFlag } from '@config/domain/config/feature-flag';

export interface FeatureFlagRepository {
  findTenantFlag(tenantId: string, key: string): Promise<FeatureFlag | null>;
  findGlobalFlag(key: string): Promise<FeatureFlag | null>;
  upsert(flag: FeatureFlag): Promise<FeatureFlag>;
}

export const FEATURE_FLAG_REPOSITORY = Symbol('FeatureFlagRepository');
