import { CreateUploadHandler } from '@media/application/create-upload.handler';
import {
  FakeMediaObjectRepository,
  FakeObjectStorage,
  FakeTenantContext,
  fakeConfig,
} from '@media/application/media-test-doubles';
import { InvalidUploadError } from '@media/domain/media/errors';
import { MediaStatus } from '@media/domain/media/media-object';

describe('CreateUploadHandler', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let repository: FakeMediaObjectRepository;
  let storage: FakeObjectStorage;
  let tenantContext: FakeTenantContext;
  let handler: CreateUploadHandler;

  beforeEach(() => {
    repository = new FakeMediaObjectRepository();
    storage = new FakeObjectStorage();
    tenantContext = new FakeTenantContext({ tenantId, actor: 'tester', roles: [] });
    handler = new CreateUploadHandler(
      repository,
      storage,
      tenantContext,
      fakeConfig({
        ALLOWED_MIME: 'image/jpeg,image/png,image/webp',
        MAX_UPLOAD_BYTES: 5_000_000,
        PRESIGN_TTL_SECONDS: 300,
      }),
    );
  });

  it('validates, writes a PENDING tenant-prefixed row, and issues a presigned PUT', async () => {
    const result = await handler.execute({ contentType: 'image/png', sizeBytes: 1_234 });

    expect(result.objectKey).toBe(`${tenantId}/${result.id}`);
    expect(result.uploadUrl).toContain(`/put/${tenantId}/${result.id}`);

    const saved = repository.rows.get(result.id);
    expect(saved?.status).toBe(MediaStatus.PENDING);
    expect(saved?.tenantId).toBe(tenantId);
    expect(saved?.contentType).toBe('image/png');
  });

  it('rejects a disallowed MIME before any row or URL is created', async () => {
    await expect(
      handler.execute({ contentType: 'application/pdf', sizeBytes: 1_000 }),
    ).rejects.toThrow(InvalidUploadError);
    expect(repository.rows.size).toBe(0);
  });

  it('rejects an over-size upload before any row or URL is created', async () => {
    await expect(
      handler.execute({ contentType: 'image/jpeg', sizeBytes: 5_000_001 }),
    ).rejects.toThrow(InvalidUploadError);
    expect(repository.rows.size).toBe(0);
  });
});
