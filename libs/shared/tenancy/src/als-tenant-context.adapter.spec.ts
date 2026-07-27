import { AlsTenantContextAdapter } from './als-tenant-context.adapter';

describe('AlsTenantContextAdapter', () => {
  let adapter: AlsTenantContextAdapter;

  beforeEach(() => {
    adapter = new AlsTenantContextAdapter();
  });

  it('throws when accessed outside a run() scope', () => {
    expect(() => adapter.getTenantIdOrThrow()).toThrow(/Tenant context is not set/);
  });

  it('exposes the tenant id set by run() within the callback', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    const result = adapter.run({ tenantId, actor: 'tester' }, () => adapter.getTenantIdOrThrow());

    expect(result).toBe(tenantId);
  });

  it('defaults the actor to "system" outside a run() scope', () => {
    expect(adapter.getActor()).toBe('system');
  });

  it('isolates context across concurrent async runs', async () => {
    const results: string[] = [];

    await Promise.all([
      adapter.run({ tenantId: 'tenant-a', actor: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(adapter.getTenantIdOrThrow());
      }),
      adapter.run({ tenantId: 'tenant-b', actor: 'b' }, async () => {
        results.push(adapter.getTenantIdOrThrow());
      }),
    ]);

    expect(results.sort()).toEqual(['tenant-a', 'tenant-b']);
  });
});
