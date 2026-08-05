import { FeatureFlag } from '@config/domain/config/feature-flag';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

describe('FeatureFlag', () => {
  it('creates a flag and trims surrounding whitespace from the key', () => {
    const flag = FeatureFlag.create({ id, tenantId, key: '  promo-banner  ', enabled: true });

    expect(flag.id).toBe(id);
    expect(flag.tenantId).toBe(tenantId);
    expect(flag.key).toBe('promo-banner');
    expect(flag.enabled).toBe(true);
    expect(flag.updatedAt).toBeInstanceOf(Date);
  });

  it('creates a global flag with a null tenantId', () => {
    const flag = FeatureFlag.create({ id, tenantId: null, key: 'global-flag', enabled: false });

    expect(flag.tenantId).toBeNull();
  });

  it('rejects an empty key', () => {
    expect(() => FeatureFlag.create({ id, tenantId, key: '   ', enabled: true })).toThrow(
      'Feature flag key is required',
    );
  });

  it('rejects a key longer than 255 characters', () => {
    const key = 'a'.repeat(256);

    expect(() => FeatureFlag.create({ id, tenantId, key, enabled: true })).toThrow(
      'Feature flag key must be at most 255 characters',
    );
  });

  it('accepts a key exactly at the 255 character limit', () => {
    const key = 'a'.repeat(255);

    expect(() => FeatureFlag.create({ id, tenantId, key, enabled: true })).not.toThrow();
  });

  it('rehydrates already-validated persistence data without re-validating', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const flag = FeatureFlag.reconstitute({
      id,
      tenantId,
      key: 'promo-banner',
      enabled: true,
      updatedAt,
    });

    expect(flag.id).toBe(id);
    expect(flag.tenantId).toBe(tenantId);
    expect(flag.key).toBe('promo-banner');
    expect(flag.enabled).toBe(true);
    expect(flag.updatedAt).toBe(updatedAt);
  });

  it('returns a new instance with the flipped enabled state and a fresh updatedAt', () => {
    const original = FeatureFlag.reconstitute({
      id,
      tenantId,
      key: 'promo-banner',
      enabled: false,
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const updated = original.withEnabled(true);

    expect(updated).not.toBe(original);
    expect(updated.enabled).toBe(true);
    expect(updated.id).toBe(original.id);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(original.enabled).toBe(false);
  });
});
