export interface StoredObjectStat {
  sizeBytes: number;
}

/**
 * Port over the object store (MinIO/S3). The app NEVER proxies bytes for the
 * upload/download path — it hands clients short-TTL presigned URLs and only
 * touches bytes itself for server-side thumbnail generation (`getObject` /
 * `putObject`).
 */
export interface ObjectStoragePort {
  /** Presigned PUT URL a client uploads DIRECTLY to (scoped to one key, short TTL). */
  presignPut(objectKey: string, ttlSeconds: number): Promise<string>;
  /** Presigned GET URL a client downloads DIRECTLY from (short TTL). */
  presignGet(objectKey: string, ttlSeconds: number): Promise<string>;
  /** Metadata for an object, or `null` when it does not exist. */
  statObject(objectKey: string): Promise<StoredObjectStat | null>;
  /** Downloads the full object into memory (thumbnail worker only). */
  getObject(objectKey: string): Promise<Buffer>;
  /** Uploads bytes server-side (thumbnail worker only). */
  putObject(objectKey: string, body: Buffer, contentType: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('ObjectStoragePort');
