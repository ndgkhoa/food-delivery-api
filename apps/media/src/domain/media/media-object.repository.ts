import type { MediaObject } from '@media/domain/media/media-object';

export interface MediaObjectRepository {
  save(media: MediaObject): Promise<MediaObject>;
  findById(id: string, tenantId: string): Promise<MediaObject | null>;
  findByIdForProcessing(id: string): Promise<MediaObject | null>;
}

export const MEDIA_OBJECT_REPOSITORY = Symbol('MediaObjectRepository');
