import { evictForConfigChange } from './config-events';
import { SettingsCache } from './settings-cache';

describe('evictForConfigChange', () => {
  it('evicts only the changed tenant entry for a tenant-scoped change', () => {
    const valueCache = new SettingsCache<number>();
    valueCache.set('t1:k', 1, 10_000);
    valueCache.set('t2:k', 2, 10_000);
    const flagCache = new SettingsCache<boolean>();

    evictForConfigChange({ tenantId: 't1', key: 'k' }, valueCache, flagCache);

    expect(valueCache.get('t1:k')).toBeUndefined();
    expect(valueCache.get('t2:k')).toBe(2);
  });

  it('evicts every tenant entry for the key on a global change', () => {
    const valueCache = new SettingsCache<number>();
    valueCache.set('t1:k', 1, 10_000);
    valueCache.set('t2:k', 2, 10_000);
    const flagCache = new SettingsCache<boolean>();

    evictForConfigChange({ tenantId: null, key: 'k' }, valueCache, flagCache);

    expect(valueCache.get('t1:k')).toBeUndefined();
    expect(valueCache.get('t2:k')).toBeUndefined();
  });

  it('evicts from both caches even though a key only ever lives in one', () => {
    const valueCache = new SettingsCache<number>();
    const flagCache = new SettingsCache<boolean>();
    flagCache.set('t1:new-ui', true, 10_000);

    evictForConfigChange({ tenantId: 't1', key: 'new-ui' }, valueCache, flagCache);

    expect(flagCache.get('t1:new-ui')).toBeUndefined();
  });
});
