import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { MediaNotFoundError } from '@media/domain/media/errors';
import type { MediaStatus } from '@media/domain/media/media-object';
import {
  MEDIA_OBJECT_REPOSITORY,
  type MediaObjectRepository,
} from '@media/domain/media/media-object.repository';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@media/domain/media/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MediaView {
  id: string;
  status: MediaStatus;
  url: string;
  thumbnailUrl?: string;
}

/**
 * Returns the current status plus short-TTL presigned GET URLs the client uses
 * to download DIRECTLY from storage: always the original, and the thumbnail once
 * the object is READY. Tenant-scoped — a caller only sees its own tenant's media.
 */
@Injectable()
export class GetMediaHandler {
  private readonly presignTtlSeconds: number;

  constructor(
    @Inject(MEDIA_OBJECT_REPOSITORY) private readonly repository: MediaObjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.presignTtlSeconds = config.getOrThrow<number>('PRESIGN_TTL_SECONDS');
  }

  async execute(id: string): Promise<MediaView> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const media = await this.repository.findById(id, tenantId);
    if (!media) {
      throw new MediaNotFoundError(id);
    }

    const url = await this.storage.presignGet(media.objectKey, this.presignTtlSeconds);
    const view: MediaView = { id: media.id, status: media.status, url };
    if (media.isReady && media.thumbnailKey) {
      view.thumbnailUrl = await this.storage.presignGet(media.thumbnailKey, this.presignTtlSeconds);
    }
    return view;
  }
}
