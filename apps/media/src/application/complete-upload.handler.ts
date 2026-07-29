import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { MediaNotFoundError, ObjectNotUploadedError } from '@media/domain/media/errors';
import type { MediaObject } from '@media/domain/media/media-object';
import {
  MEDIA_OBJECT_REPOSITORY,
  type MediaObjectRepository,
} from '@media/domain/media/media-object.repository';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@media/domain/media/object-storage.port';
import { THUMBNAIL_QUEUE, type ThumbnailQueuePort } from '@media/domain/media/thumbnail-queue.port';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Confirms a client finished its direct upload: it verifies the bytes actually
 * exist in storage (a client cannot mark complete without uploading), advances
 * the row to UPLOADED, and enqueues thumbnail generation. Tenant-scoped — a
 * caller can only complete its own tenant's object. Idempotent: re-completing
 * re-enqueues (deduped by media id) and never regresses a READY row.
 */
@Injectable()
export class CompleteUploadHandler {
  constructor(
    @Inject(MEDIA_OBJECT_REPOSITORY) private readonly repository: MediaObjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(THUMBNAIL_QUEUE) private readonly queue: ThumbnailQueuePort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(id: string): Promise<MediaObject> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const media = await this.repository.findById(id, tenantId);
    if (!media) {
      throw new MediaNotFoundError(id);
    }

    const stat = await this.storage.statObject(media.objectKey);
    if (!stat) {
      throw new ObjectNotUploadedError(id);
    }

    const uploaded = media.isPending ? media.markUploaded() : media;
    if (uploaded !== media) {
      await this.repository.save(uploaded);
    }
    await this.queue.enqueue(id);
    return uploaded;
  }
}
