import { MediaObject, type MediaObjectProps, MediaStatus } from '@media/domain/media/media-object';

function buildProps(overrides: Partial<MediaObjectProps> = {}): MediaObjectProps {
  return {
    id: 'media-1',
    tenantId: 'tenant-1',
    objectKey: 'uploads/media-1.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    status: MediaStatus.PENDING,
    thumbnailKey: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MediaObject', () => {
  it('creates a pending media object with no thumbnail and matching timestamps', () => {
    const media = MediaObject.create({
      id: 'media-1',
      tenantId: 'tenant-1',
      objectKey: 'uploads/media-1.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });

    expect(media.id).toBe('media-1');
    expect(media.tenantId).toBe('tenant-1');
    expect(media.objectKey).toBe('uploads/media-1.jpg');
    expect(media.contentType).toBe('image/jpeg');
    expect(media.sizeBytes).toBe(2048);
    expect(media.status).toBe(MediaStatus.PENDING);
    expect(media.thumbnailKey).toBeNull();
    expect(media.isPending).toBe(true);
    expect(media.isReady).toBe(false);
    expect(media.createdAt).toEqual(media.updatedAt);
  });

  it('reconstitutes a media object from persisted props unchanged', () => {
    const props = buildProps({ status: MediaStatus.READY, thumbnailKey: 'thumbs/media-1.jpg' });

    const media = MediaObject.reconstitute(props);

    expect(media.id).toBe(props.id);
    expect(media.status).toBe(MediaStatus.READY);
    expect(media.thumbnailKey).toBe('thumbs/media-1.jpg');
    expect(media.createdAt).toBe(props.createdAt);
    expect(media.updatedAt).toBe(props.updatedAt);
    expect(media.isReady).toBe(true);
    expect(media.isPending).toBe(false);
  });

  it('marks a pending media object as uploaded and bumps updatedAt', () => {
    const media = MediaObject.reconstitute(buildProps());

    const uploaded = media.markUploaded();

    expect(uploaded.status).toBe(MediaStatus.UPLOADED);
    expect(uploaded.thumbnailKey).toBeNull();
    expect(uploaded.updatedAt.getTime()).toBeGreaterThanOrEqual(media.updatedAt.getTime());
  });

  it('marks an uploaded media object as ready with a thumbnail key', () => {
    const media = MediaObject.reconstitute(buildProps({ status: MediaStatus.UPLOADED }));

    const ready = media.markReady('thumbs/media-1.jpg');

    expect(ready.status).toBe(MediaStatus.READY);
    expect(ready.thumbnailKey).toBe('thumbs/media-1.jpg');
    expect(ready.isReady).toBe(true);
  });
});
