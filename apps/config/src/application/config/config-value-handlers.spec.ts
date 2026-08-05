import { GetConfigValueHandler } from '@config/application/config/get-config-value.handler';
import { ListConfigValuesHandler } from '@config/application/config/list-config-values.handler';
import { UpsertConfigValueHandler } from '@config/application/config/upsert-config-value.handler';
import { ConfigEntry } from '@config/domain/config/config-entry';
import { ConfigEntryNotFoundError } from '@config/domain/shared/errors';
import {
  FakeConfigEntryRepository,
  FakeConfigEventPublisher,
  FakeTenantContext,
} from '@config/testing/config-test-doubles';

describe('ConfigValueHandlers', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let repository: FakeConfigEntryRepository;
  let publisher: FakeConfigEventPublisher;
  let tenantContext: FakeTenantContext;

  beforeEach(() => {
    repository = new FakeConfigEntryRepository();
    publisher = new FakeConfigEventPublisher();
    tenantContext = new FakeTenantContext({ tenantId, actor: 'tester', roles: ['admin'] });
  });

  describe('GetConfigValueHandler', () => {
    it('prefers the tenant override over the global default', async () => {
      await repository.upsert(
        ConfigEntry.create({ id: 'g', tenantId: null, key: 'k', value: 1500 }),
      );
      await repository.upsert(ConfigEntry.create({ id: 't', tenantId, key: 'k', value: 250 }));
      const handler = new GetConfigValueHandler(repository, tenantContext);

      await expect(handler.execute('k')).resolves.toBe(250);
    });

    it('falls back to the global default when no tenant override exists', async () => {
      await repository.upsert(
        ConfigEntry.create({ id: 'g', tenantId: null, key: 'k', value: 1500 }),
      );
      const handler = new GetConfigValueHandler(repository, tenantContext);

      await expect(handler.execute('k')).resolves.toBe(1500);
    });

    it('throws ConfigEntryNotFoundError when neither row exists', async () => {
      const handler = new GetConfigValueHandler(repository, tenantContext);

      await expect(handler.execute('missing')).rejects.toThrow(ConfigEntryNotFoundError);
    });
  });

  describe('ListConfigValuesHandler', () => {
    it('merges tenant + global rows, tenant winning on a shared key', async () => {
      await repository.upsert(ConfigEntry.create({ id: 'g1', tenantId: null, key: 'a', value: 1 }));
      await repository.upsert(ConfigEntry.create({ id: 'g2', tenantId: null, key: 'b', value: 2 }));
      await repository.upsert(ConfigEntry.create({ id: 't1', tenantId, key: 'a', value: 99 }));
      const handler = new ListConfigValuesHandler(repository, tenantContext);

      await expect(handler.execute()).resolves.toEqual([
        { key: 'a', value: 99, scope: 'tenant' },
        { key: 'b', value: 2, scope: 'global' },
      ]);
    });
  });

  describe('UpsertConfigValueHandler', () => {
    it('writes the caller tenant override and emits ConfigValueChanged', async () => {
      const handler = new UpsertConfigValueHandler(repository, tenantContext, publisher);

      await expect(
        handler.execute({ key: 'order.delivery_fee_cents', value: 1200, global: false }),
      ).resolves.toBe(1200);

      const saved = await repository.findTenantEntry(tenantId, 'order.delivery_fee_cents');
      expect(saved?.value).toBe(1200);
      expect(publisher.valueChanges).toEqual([{ tenantId, key: 'order.delivery_fee_cents' }]);
    });

    it('updates an existing row in place rather than duplicating it', async () => {
      const handler = new UpsertConfigValueHandler(repository, tenantContext, publisher);
      await handler.execute({ key: 'k', value: 100, global: false });
      await handler.execute({ key: 'k', value: 200, global: false });

      const all = await repository.findAllForTenant(tenantId);
      expect(all).toHaveLength(1);
      expect(all[0].value).toBe(200);
    });

    it('rejects a global write from a caller without the platform-admin role', async () => {
      const handler = new UpsertConfigValueHandler(repository, tenantContext, publisher);

      await expect(
        handler.execute({ key: 'order.delivery_fee_cents', value: 1200, global: true }),
      ).rejects.toThrow('platform-admin');
      expect(publisher.valueChanges).toHaveLength(0);
    });

    it('allows a global write from a platform-admin and stores it with a null tenant', async () => {
      tenantContext.setRoles(['platform-admin']);
      const handler = new UpsertConfigValueHandler(repository, tenantContext, publisher);

      await handler.execute({ key: 'order.delivery_fee_cents', value: 1500, global: true });

      const saved = await repository.findGlobalEntry('order.delivery_fee_cents');
      expect(saved?.value).toBe(1500);
      expect(publisher.valueChanges).toEqual([{ tenantId: null, key: 'order.delivery_fee_cents' }]);
    });
  });
});
