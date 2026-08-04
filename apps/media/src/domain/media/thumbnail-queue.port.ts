export interface ThumbnailQueuePort {
  enqueue(mediaId: string): Promise<void>;
}

export const THUMBNAIL_QUEUE = Symbol('ThumbnailQueuePort');

export const THUMBNAIL_QUEUE_NAME = 'media-thumbnails';
