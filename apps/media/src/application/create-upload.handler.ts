import { randomUUID } from 'node:crypto';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { buildObjectKey } from '@media/domain/media/media-keys';
import { MediaObject } from '@media/domain/media/media-object';
import {
  MEDIA_OBJECT_REPOSITORY,
  type MediaObjectRepository,
} from '@media/domain/media/media-object.repository';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@media/domain/media/object-storage.port';
import { assertAllowedUpload } from '@media/domain/media/upload-validation';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateUploadCommand {
  contentType: string;
  sizeBytes: number;
}

export interface CreateUploadResult {
  id: string;
  objectKey: string;
  uploadUrl: string;
}

@Injectable()
export class CreateUploadHandler {
  private readonly allowedMimes: string[];
  private readonly maxBytes: number;
  private readonly presignTtlSeconds: number;

  constructor(
    @Inject(MEDIA_OBJECT_REPOSITORY) private readonly repository: MediaObjectRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    config: ConfigService,
  ) {
    this.allowedMimes = config
      .getOrThrow<string>('ALLOWED_MIME')
      .split(',')
      .map((mime) => mime.trim());
    this.maxBytes = config.getOrThrow<number>('MAX_UPLOAD_BYTES');
    this.presignTtlSeconds = config.getOrThrow<number>('PRESIGN_TTL_SECONDS');
  }

  async execute(command: CreateUploadCommand): Promise<CreateUploadResult> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    assertAllowedUpload(command.contentType, command.sizeBytes, this.allowedMimes, this.maxBytes);

    const id = randomUUID();
    const objectKey = buildObjectKey(tenantId, id);
    const media = MediaObject.create({
      id,
      tenantId,
      objectKey,
      contentType: command.contentType,
      sizeBytes: command.sizeBytes,
    });
    await this.repository.save(media);

    const uploadUrl = await this.storage.presignPut(objectKey, this.presignTtlSeconds);
    return { id, objectKey, uploadUrl };
  }
}
