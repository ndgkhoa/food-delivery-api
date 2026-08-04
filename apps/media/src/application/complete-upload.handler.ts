import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import {
  InvalidUploadError,
  MediaNotFoundError,
  ObjectNotUploadedError,
} from '@media/domain/media/errors';
import type { MediaObject } from '@media/domain/media/media-object';
import {
  MEDIA_OBJECT_REPOSITORY,
  type MediaObjectRepository,
} from '@media/domain/media/media-object.repository';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@media/domain/media/object-storage.port';
import { THUMBNAIL_QUEUE, type ThumbnailQueuePort } from '@media/domain/media/thumbnail-queue.port';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CompleteUploadHandler {
  private readonly maxBytes: number;

  constructor(
    @Inject(MEDIA_OBJECT_REPOSITORY) private readonly repository: MediaObjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(THUMBNAIL_QUEUE) private readonly queue: ThumbnailQueuePort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.maxBytes = config.getOrThrow<number>('MAX_UPLOAD_BYTES');
  }

  async execute(id: string): Promise<MediaObject> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const media = await this.repository.findById(id, tenantId);
    if (!media) {
      throw new MediaNotFoundError(id);
    }
    if (media.isReady) {
      return media;
    }

    const stat = await this.storage.statObject(media.objectKey);
    if (!stat) {
      throw new ObjectNotUploadedError(id);
    }

    if (stat.sizeBytes > this.maxBytes) {
      await this.storage.removeObject(media.objectKey);
      throw new InvalidUploadError(
        `Uploaded object is ${stat.sizeBytes} bytes, over the ${this.maxBytes} byte limit`,
      );
    }

    const uploaded = media.isPending ? media.markUploaded() : media;
    if (uploaded !== media) {
      await this.repository.save(uploaded);
    }
    await this.queue.enqueue(id);
    return uploaded;
  }
}
