import {
  FakeConfigEventPublisher,
  FakeFeatureFlagRepository,
  FakeTenantContext,
} from '@config/application/config/config-test-doubles';
import { GetFeatureFlagHandler } from '@config/application/config/get-feature-flag.handler';
import { UpsertFeatureFlagHandler } from '@config/application/config/upsert-feature-flag.handler';
import { FeatureFlag } from '@config/domain/config/feature-flag';
import {
  FeatureFlagNotFoundError,
  GlobalWriteRequiresPlatformAdminError,
} from '@config/domain/shared/errors';

describe('feature flag handlers', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  let repository: FakeFeatureFlagRepository;
  let publisher: FakeConfigEventPublisher;
  let tenantContext: FakeTenantContext;

  beforeEach(() => {
    repository = new FakeFeatureFlagRepository();
    publisher = new FakeConfigEventPublisher();
    tenantContext = new FakeTenantContext({ tenantId, actor: 'tester', roles: ['admin'] });
  });

  describe('GetFeatureFlagHandler', () => {
    it('prefers the tenant override over the global default', async () => {
      await repository.upsert(
        FeatureFlag.create({ id: 'g', tenantId: null, key: 'k', enabled: true }),
      );
      await repository.upsert(FeatureFlag.create({ id: 't', tenantId, key: 'k', enabled: false }));
      const handler = new GetFeatureFlagHandler(repository, tenantContext);

      await expect(handler.execute('k')).resolves.toBe(false);
    });

    it('throws FeatureFlagNotFoundError when neither row exists', async () => {
      const handler = new GetFeatureFlagHandler(repository, tenantContext);

      await expect(handler.execute('missing')).rejects.toThrow(FeatureFlagNotFoundError);
    });
  });

  describe('UpsertFeatureFlagHandler', () => {
    it('writes the caller tenant override and emits FeatureFlagChanged', async () => {
      const handler = new UpsertFeatureFlagHandler(repository, tenantContext, publisher);

      await expect(handler.execute({ key: 'new-ui', enabled: true, global: false })).resolves.toBe(
        true,
      );
      expect(publisher.flagChanges).toEqual([{ tenantId, key: 'new-ui' }]);
    });

    it('rejects a global write from a caller without the platform-admin role', async () => {
      const handler = new UpsertFeatureFlagHandler(repository, tenantContext, publisher);

      await expect(handler.execute({ key: 'new-ui', enabled: true, global: true })).rejects.toThrow(
        GlobalWriteRequiresPlatformAdminError,
      );
    });

    it('allows a global write from a platform-admin and stores it with a null tenant', async () => {
      tenantContext.setRoles(['platform-admin']);
      const handler = new UpsertFeatureFlagHandler(repository, tenantContext, publisher);

      await handler.execute({ key: 'new-ui', enabled: true, global: true });

      const saved = await repository.findGlobalFlag('new-ui');
      expect(saved?.enabled).toBe(true);
    });
  });
});
