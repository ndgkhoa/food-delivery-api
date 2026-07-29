import type { MediaStatus } from '@media/domain/media/media-object';

/** Response to a create-upload: the id + object key + the presigned PUT URL. */
export interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}

/** Response to a completion: the id + the (now UPLOADED) status. */
export interface CompleteUploadResponse {
  id: string;
  status: MediaStatus;
}

/** Response to a get: status + presigned GET URLs (thumbnail present once READY). */
export interface MediaResponse {
  id: string;
  status: MediaStatus;
  url: string;
  thumbnailUrl?: string;
}
