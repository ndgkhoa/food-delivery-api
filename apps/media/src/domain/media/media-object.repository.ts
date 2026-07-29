import type { MediaObject } from '@media/domain/media/media-object';

export interface MediaObjectRepository {
  save(media: MediaObject): Promise<MediaObject>;
  /** Request-scoped lookup — resolves only within the caller's tenant. */
  findById(id: string, tenantId: string): Promise<MediaObject | null>;
  /**
   * Tenant-agnostic lookup for the trusted background thumbnail worker, which
   * runs outside any request scope and only carries a media id. Never exposed to
   * a request-driven use case.
   */
  findByIdForProcessing(id: string): Promise<MediaObject | null>;
}

export const MEDIA_OBJECT_REPOSITORY = Symbol('MediaObjectRepository');
