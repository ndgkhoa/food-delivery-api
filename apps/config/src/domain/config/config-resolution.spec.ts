import { ConfigEntry } from '@config/domain/config/config-entry';
import { resolveConfigValue, resolveFeatureFlag } from '@config/domain/config/config-resolution';
import { FeatureFlag } from '@config/domain/config/feature-flag';

function entry(tenantId: string | null, value: number): ConfigEntry {
  return ConfigEntry.create({ id: 'id', tenantId, key: 'k', value });
}

function flag(tenantId: string | null, enabled: boolean): FeatureFlag {
  return FeatureFlag.create({ id: 'id', tenantId, key: 'k', enabled });
}

describe('resolveConfigValue', () => {
  it('prefers the tenant override over the global default', () => {
    expect(resolveConfigValue(entry('tenant-1', 100), entry(null, 1500))).toBe(100);
  });

  it('falls back to the global default when no tenant override exists', () => {
    expect(resolveConfigValue(null, entry(null, 1500))).toBe(1500);
  });

  it('returns undefined when neither a tenant nor a global row exists', () => {
    expect(resolveConfigValue(null, null)).toBeUndefined();
  });
});

describe('resolveFeatureFlag', () => {
  it('prefers the tenant override over the global default', () => {
    expect(resolveFeatureFlag(flag('tenant-1', false), flag(null, true))).toBe(false);
  });

  it('falls back to the global default when no tenant override exists', () => {
    expect(resolveFeatureFlag(null, flag(null, true))).toBe(true);
  });

  it('returns undefined when neither a tenant nor a global row exists', () => {
    expect(resolveFeatureFlag(null, null)).toBeUndefined();
  });
});
