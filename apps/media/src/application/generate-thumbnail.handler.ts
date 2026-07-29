import { MediaNotFoundError } from '@media/domain/media/errors';
import { IMAGE_PROCESSOR, type ImageProcessorPort } from '@media/domain/media/image-processor.port';
import { buildThumbnailKey } from '@media/domain/media/media-keys';
import {
  MEDIA_OBJECT_REPOSITORY,
  type MediaObjectRepository,
} from '@media/domain/media/media-object.repository';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@media/domain/media/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The thumbnail worker's use case, driven by the background queue (no request
 * scope, so it loads the row tenant-agnostically). Idempotent: a READY row is a
 * no-op, and the thumbnail key is deterministic so a retry overwrites the same
 * object. The row is only marked READY AFTER the thumbnail is stored — if any
 * step throws, the job fails/retries and the row stays UPLOADED (never a false
 * READY).
 */
@Injectable()
export class GenerateThumbnailHandler {
  private readonly thumbnailWidth: number;
  private readonly maxBytes: number;

  constructor(
    @Inject(MEDIA_OBJECT_REPOSITORY) private readonly repository: MediaObjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(IMAGE_PROCESSOR) private readonly imageProcessor: ImageProcessorPort,
    config: ConfigService,
  ) {
    this.thumbnailWidth = config.getOrThrow<number>('THUMBNAIL_WIDTH');
    this.maxBytes = config.getOrThrow<number>('MAX_UPLOAD_BYTES');
  }

  async execute(mediaId: string): Promise<void> {
    const media = await this.repository.findByIdForProcessing(mediaId);
    if (!media) {
      throw new MediaNotFoundError(mediaId);
    }
    if (media.isReady) {
      return;
    }

    const original = await this.storage.getObject(media.objectKey, this.maxBytes);
    const thumbnail = await this.imageProcessor.resizeToWidth(original, this.thumbnailWidth);
    const thumbnailKey = buildThumbnailKey(media.tenantId, media.id);
    await this.storage.putObject(thumbnailKey, thumbnail, media.contentType);

    await this.repository.save(media.markReady(thumbnailKey));
  }
}
