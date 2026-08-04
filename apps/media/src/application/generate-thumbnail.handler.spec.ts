import { GenerateThumbnailHandler } from '@media/application/generate-thumbnail.handler';
import type { ImageProcessorPort } from '@media/domain/media/image-processor.port';
import { buildObjectKey, buildThumbnailKey } from '@media/domain/media/media-keys';
import { MediaObject, MediaStatus } from '@media/domain/media/media-object';
import {
  FakeMediaObjectRepository,
  FakeObjectStorage,
  fakeConfig,
} from '@media/testing/media-test-doubles';

/** Fake resize: returns a strictly smaller buffer so "thumbnail is smaller" is assertable. */
class HalvingImageProcessor implements ImageProcessorPort {
  async resizeToWidth(input: Buffer): Promise<Buffer> {
    return input.subarray(0, Math.max(1, Math.floor(input.length / 2)));
  }
}

describe('GenerateThumbnailHandler', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let repository: FakeMediaObjectRepository;
  let storage: FakeObjectStorage;
  let handler: GenerateThumbnailHandler;

  const seedUploaded = (): MediaObject => {
    const objectKey = buildObjectKey(tenantId, id);
    const media = MediaObject.create({
      id,
      tenantId,
      objectKey,
      contentType: 'image/png',
      sizeBytes: 8,
    }).markUploaded();
    repository.rows.set(id, media);
    storage.putBytes(objectKey, Buffer.from('originalbytes'));
    return media;
  };

  beforeEach(() => {
    repository = new FakeMediaObjectRepository();
    storage = new FakeObjectStorage();
    handler = new GenerateThumbnailHandler(
      repository,
      storage,
      new HalvingImageProcessor(),
      fakeConfig({ THUMBNAIL_WIDTH: 200, MAX_UPLOAD_BYTES: 5_000_000 }),
    );
  });

  it('stores a smaller thumbnail and marks the row READY with the thumbnail key', async () => {
    seedUploaded();

    await handler.execute(id);

    const thumbnailKey = buildThumbnailKey(tenantId, id);
    const updated = repository.rows.get(id);
    expect(updated?.status).toBe(MediaStatus.READY);
    expect(updated?.thumbnailKey).toBe(thumbnailKey);

    const original = storage.objects.get(buildObjectKey(tenantId, id));
    const thumbnail = storage.objects.get(thumbnailKey);
    expect(thumbnail).toBeDefined();
    expect(thumbnail?.body.length).toBeLessThan(original?.body.length ?? 0);
  });

  it('is idempotent: a READY row is left untouched (no false re-work)', async () => {
    const ready = seedUploaded().markReady(buildThumbnailKey(tenantId, id));
    repository.rows.set(id, ready);
    storage.objects.delete(buildObjectKey(tenantId, id)); // would throw if re-fetched

    await expect(handler.execute(id)).resolves.toBeUndefined();
    expect(repository.rows.get(id)?.status).toBe(MediaStatus.READY);
  });
});
