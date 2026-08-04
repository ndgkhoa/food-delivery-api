import { buildObjectKey, buildThumbnailKey } from '@media/domain/media/media-keys';

describe('media object keys', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('prefixes the object key with the tenant id for per-tenant isolation', () => {
    expect(buildObjectKey(tenantId, id)).toBe(`${tenantId}/${id}`);
  });

  it('derives a deterministic thumbnail key under the same tenant prefix', () => {
    expect(buildThumbnailKey(tenantId, id)).toBe(`${tenantId}/${id}_thumb`);
    expect(buildThumbnailKey(tenantId, id)).toBe(buildThumbnailKey(tenantId, id));
  });

  it('keeps different tenants in separate namespaces for the same id', () => {
    const otherTenant = '22222222-2222-4222-8222-222222222222';
    expect(buildObjectKey(tenantId, id)).not.toBe(buildObjectKey(otherTenant, id));
  });
});
