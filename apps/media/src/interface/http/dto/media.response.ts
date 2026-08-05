import type { MediaStatus } from '@media/domain/media/media-object';

export interface CreateUploadResponse {
  id: string;
  objectKey: string;
  uploadUrl: string;
}

export interface CompleteUploadResponse {
  id: string;
  status: MediaStatus;
}

export interface MediaResponse {
  id: string;
  status: MediaStatus;
  url?: string;
  thumbnailUrl?: string;
}
