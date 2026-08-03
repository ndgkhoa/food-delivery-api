import { CompleteUploadHandler } from '@media/application/complete-upload.handler';
import {
  FakeMediaObjectRepository,
  FakeObjectStorage,
  FakeTenantContext,
  FakeThumbnailQueue,
  fakeConfig,
} from '@media/application/media-test-doubles';
import {
  InvalidUploadError,
  MediaNotFoundError,
  ObjectNotUploadedError,
} from '@media/domain/media/errors';
import { buildObjectKey } from '@media/domain/media/media-keys';
import { MediaObject, MediaStatus } from '@media/domain/media/media-object';

describe('CompleteUploadHandler', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  let repository: FakeMediaObjectRepository;
  let storage: FakeObjectStorage;
  let queue: FakeThumbnailQueue;
  let tenantContext: FakeTenantContext;
  let handler: CompleteUploadHandler;

  const seedPending = (id: string, owner: string): MediaObject => {
    const objectKey = buildObjectKey(owner, id);
    const media = MediaObject.create({
      id,
      tenantId: owner,
      objectKey,
      contentType: 'image/png',
      sizeBytes: 1_000,
    });
    repository.rows.set(id, media);
    return media;
  };

  beforeEach(() => {
    repository = new FakeMediaObjectRepository();
    storage = new FakeObjectStorage();
    queue = new FakeThumbnailQueue();
    tenantContext = new FakeTenantContext({ tenantId, actor: 'tester', roles: [] });
    handler = new CompleteUploadHandler(
      repository,
      storage,
      queue,
      tenantContext,
      fakeConfig({ ALLOWED_MIME: 'image/jpeg,image/png,image/webp', MAX_UPLOAD_BYTES: 1_000_000 }),
    );
  });

  it('marks UPLOADED and enqueues a thumbnail job once the object is present', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const media = seedPending(id, tenantId);
    storage.putBytes(media.objectKey, Buffer.from('bytes'));

    const result = await handler.execute(id);

    expect(result.status).toBe(MediaStatus.UPLOADED);
    expect(repository.rows.get(id)?.status).toBe(MediaStatus.UPLOADED);
    expect(queue.enqueued).toEqual([id]);
  });

  it('deletes + rejects an actually-oversized object (declared size is not trusted)', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const media = seedPending(id, tenantId); // declared 1000 bytes
    // The bytes the client actually PUT are 2 MB — past the 1 MB ceiling.
    storage.putBytes(media.objectKey, Buffer.alloc(2_000_000), 'image/png');

    await expect(handler.execute(id)).rejects.toBeInstanceOf(InvalidUploadError);
    expect(storage.removed).toContain(media.objectKey); // cleaned up, never enqueued
    expect(queue.enqueued).toEqual([]);
    expect(repository.rows.get(id)?.status).toBe(MediaStatus.PENDING);
  });

  it('rejects completion when the object was never uploaded (409 signal)', async () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    seedPending(id, tenantId);

    await expect(handler.execute(id)).rejects.toThrow(ObjectNotUploadedError);
    expect(queue.enqueued).toHaveLength(0);
    expect(repository.rows.get(id)?.status).toBe(MediaStatus.PENDING);
  });

  it('does not let one tenant complete another tenant’s object', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const media = seedPending(id, otherTenantId);
    storage.putBytes(media.objectKey, Buffer.from('bytes'));

    await expect(handler.execute(id)).rejects.toThrow(MediaNotFoundError);
    expect(queue.enqueued).toHaveLength(0);
  });
});
