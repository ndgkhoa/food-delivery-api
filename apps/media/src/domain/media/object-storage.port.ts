export interface StoredObjectStat {
  sizeBytes: number;
  contentType: string | undefined;
}

export interface ObjectStoragePort {
  presignPut(objectKey: string, ttlSeconds: number): Promise<string>;
  presignGet(objectKey: string, ttlSeconds: number): Promise<string>;
  statObject(objectKey: string): Promise<StoredObjectStat | null>;
  removeObject(objectKey: string): Promise<void>;
  getObject(objectKey: string, maxBytes: number): Promise<Buffer>;
  putObject(objectKey: string, body: Buffer, contentType: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('ObjectStoragePort');
