import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  it('throws when accessed outside a run() scope', () => {
    expect(() => service.getTenantIdOrThrow()).toThrow(/Tenant context is not set/);
  });

  it('exposes the tenant id set by run() within the callback', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    const result = service.run({ tenantId, actor: 'tester' }, () => service.getTenantIdOrThrow());

    expect(result).toBe(tenantId);
  });

  it('defaults the actor to "system" outside a run() scope', () => {
    expect(service.getActor()).toBe('system');
  });

  it('isolates context across concurrent async runs', async () => {
    const results: string[] = [];

    await Promise.all([
      service.run({ tenantId: 'tenant-a', actor: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(service.getTenantIdOrThrow());
      }),
      service.run({ tenantId: 'tenant-b', actor: 'b' }, async () => {
        results.push(service.getTenantIdOrThrow());
      }),
    ]);

    expect(results.sort()).toEqual(['tenant-a', 'tenant-b']);
  });
});
