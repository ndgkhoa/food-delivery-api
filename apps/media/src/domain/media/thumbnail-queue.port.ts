/**
 * Port over the internal thumbnail work queue. The completion use case enqueues
 * a job; the background worker consumes it and generates the thumbnail. Kept a
 * plain interface so the domain/application layers never see BullMQ.
 */
export interface ThumbnailQueuePort {
  enqueue(mediaId: string): Promise<void>;
}

export const THUMBNAIL_QUEUE = Symbol('ThumbnailQueuePort');

/**
 * Queue name shared by the producer adapter (infrastructure) and the worker
 * consumer (interface). A stable identifier — not an infrastructure import — so
 * the interface worker can reference it without crossing the layer boundary.
 */
export const THUMBNAIL_QUEUE_NAME = 'media-thumbnails';
