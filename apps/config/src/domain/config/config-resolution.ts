import type { ConfigEntry } from '@config/domain/config/config-entry';
import type { FeatureFlag } from '@config/domain/config/feature-flag';

export function resolveConfigValue(
  tenantEntry: ConfigEntry | null,
  globalEntry: ConfigEntry | null,
): number | undefined {
  return (tenantEntry ?? globalEntry)?.value;
}

export function resolveFeatureFlag(
  tenantFlag: FeatureFlag | null,
  globalFlag: FeatureFlag | null,
): boolean | undefined {
  return (tenantFlag ?? globalFlag)?.enabled;
}
