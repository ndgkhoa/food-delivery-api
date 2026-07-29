import type { ConfigEntry } from '@config/domain/config/config-entry';
import type { FeatureFlag } from '@config/domain/config/feature-flag';

/**
 * The single resolution rule shared by every config read: a tenant's own
 * override always wins; absent that, the global default applies; `undefined`
 * when neither row exists (the HTTP edge maps that to 404 — the client
 * library, not this service, owns the "caller-supplied default" fallback).
 */
export function resolveConfigValue(
  tenantEntry: ConfigEntry | null,
  globalEntry: ConfigEntry | null,
): number | undefined {
  return (tenantEntry ?? globalEntry)?.value;
}

/** Same tenant-override-wins rule, for boolean feature flags. */
export function resolveFeatureFlag(
  tenantFlag: FeatureFlag | null,
  globalFlag: FeatureFlag | null,
): boolean | undefined {
  return (tenantFlag ?? globalFlag)?.enabled;
}
