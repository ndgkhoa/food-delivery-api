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

/**
 * Confirms a client finished its direct upload. A presigned PUT lets the client
 * write ARBITRARY bytes, so the create-time size is only a declaration — here we
 * re-check the ACTUAL stored size (MinIO-reported, not client-controlled) and
 * delete + reject anything past the byte ceiling, so an oversized blob can never
 * reach and OOM the thumbnail worker. Actual image validity is enforced by sharp
 * in the worker (a non-image fails the job and leaves the row UPLOADED, never a
 * false READY), so content-type — which the client controls on the PUT — is not
 * re-checked here. Only after the size check does the row advance to UPLOADED and
 * a thumbnail job enqueue. Tenant-scoped and idempotent — a READY row is a no-op;
 * an UPLOADED one re-enqueues (deduped by media id).
 */
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

    // The bytes the client actually PUT — NOT the size it declared at create. An
    // oversized object is deleted so it can't cost storage or OOM the worker.
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
