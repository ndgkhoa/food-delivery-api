import { ConfigEntry } from '@config/domain/config/config-entry';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

describe('ConfigEntry', () => {
  it('creates an entry and trims surrounding whitespace from the key', () => {
    const entry = ConfigEntry.create({ id, tenantId, key: '  max-retries  ', value: 3 });

    expect(entry.id).toBe(id);
    expect(entry.tenantId).toBe(tenantId);
    expect(entry.key).toBe('max-retries');
    expect(entry.value).toBe(3);
    expect(entry.updatedAt).toBeInstanceOf(Date);
  });

  it('creates a global entry with a null tenantId', () => {
    const entry = ConfigEntry.create({ id, tenantId: null, key: 'global-key', value: 0 });

    expect(entry.tenantId).toBeNull();
  });

  it('rejects an empty key', () => {
    expect(() => ConfigEntry.create({ id, tenantId, key: '   ', value: 1 })).toThrow(
      'Config key is required',
    );
  });

  it('rejects a key longer than 255 characters', () => {
    const key = 'a'.repeat(256);

    expect(() => ConfigEntry.create({ id, tenantId, key, value: 1 })).toThrow(
      'Config key must be at most 255 characters',
    );
  });

  it('rejects a non-integer value', () => {
    expect(() => ConfigEntry.create({ id, tenantId, key: 'k', value: 1.5 })).toThrow(
      'Config value must be an integer',
    );
  });

  it('rejects a value below the minimum', () => {
    expect(() => ConfigEntry.create({ id, tenantId, key: 'k', value: -1 })).toThrow(
      `Config value must be between 0 and ${Number.MAX_SAFE_INTEGER}`,
    );
  });

  it('rejects a value above the maximum', () => {
    expect(() =>
      ConfigEntry.create({ id, tenantId, key: 'k', value: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(`Config value must be between 0 and ${Number.MAX_SAFE_INTEGER}`);
  });

  it('rehydrates already-validated persistence data without re-validating', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const entry = ConfigEntry.reconstitute({
      id,
      tenantId,
      key: 'max-retries',
      value: 5,
      updatedAt,
    });

    expect(entry.id).toBe(id);
    expect(entry.tenantId).toBe(tenantId);
    expect(entry.key).toBe('max-retries');
    expect(entry.value).toBe(5);
    expect(entry.updatedAt).toBe(updatedAt);
  });

  it('returns a new instance with the updated value and a fresh updatedAt', () => {
    const original = ConfigEntry.reconstitute({
      id,
      tenantId,
      key: 'max-retries',
      value: 3,
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const updated = original.withValue(10);

    expect(updated).not.toBe(original);
    expect(updated.value).toBe(10);
    expect(updated.id).toBe(original.id);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(original.value).toBe(3);
  });

  it('rejects an invalid value when updating', () => {
    const original = ConfigEntry.create({ id, tenantId, key: 'max-retries', value: 3 });

    expect(() => original.withValue(-5)).toThrow(
      `Config value must be between 0 and ${Number.MAX_SAFE_INTEGER}`,
    );
  });
});
