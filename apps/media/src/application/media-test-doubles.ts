import type { TenantContextPort, TenantRequestContext } from '@food-delivery-api/shared-tenancy';
import type { MediaObject } from '@media/domain/media/media-object';
import type { MediaObjectRepository } from '@media/domain/media/media-object.repository';
import type { ObjectStoragePort, StoredObjectStat } from '@media/domain/media/object-storage.port';
import type { ThumbnailQueuePort } from '@media/domain/media/thumbnail-queue.port';
import type { ConfigService } from '@nestjs/config';

/** In-memory repository — no DB. Backs both the request-scoped and worker lookups. */
export class FakeMediaObjectRepository implements MediaObjectRepository {
  readonly rows = new Map<string, MediaObject>();

  async save(media: MediaObject): Promise<MediaObject> {
    this.rows.set(media.id, media);
    return media;
  }

  async findById(id: string, tenantId: string): Promise<MediaObject | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async findByIdForProcessing(id: string): Promise<MediaObject | null> {
    return this.rows.get(id) ?? null;
  }
}

/**
 * In-memory object store. Presigned URLs are synthetic; `putBytes` seeds an
 * object so `statObject` reports it present (simulating a completed client PUT).
 */
export class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  readonly removed: string[] = [];

  /** Seeds an object as a completed client PUT — content type simulates what MinIO stat would report. */
  putBytes(objectKey: string, body: Buffer, contentType = 'image/png'): void {
    this.objects.set(objectKey, { body, contentType });
  }

  async presignPut(objectKey: string, ttlSeconds: number): Promise<string> {
    return `https://storage.test/put/${objectKey}?ttl=${ttlSeconds}`;
  }

  async presignGet(objectKey: string, ttlSeconds: number): Promise<string> {
    return `https://storage.test/get/${objectKey}?ttl=${ttlSeconds}`;
  }

  async statObject(objectKey: string): Promise<StoredObjectStat | null> {
    const object = this.objects.get(objectKey);
    return object ? { sizeBytes: object.body.length, contentType: object.contentType } : null;
  }

  async removeObject(objectKey: string): Promise<void> {
    this.removed.push(objectKey);
    this.objects.delete(objectKey);
  }

  async getObject(objectKey: string, maxBytes: number): Promise<Buffer> {
    const object = this.objects.get(objectKey);
    if (!object) {
      throw new Error(`object "${objectKey}" not found`);
    }
    if (object.body.length > maxBytes) {
      throw new Error(`object "${objectKey}" exceeds the ${maxBytes} byte cap`);
    }
    return object.body;
  }

  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(objectKey, { body, contentType });
  }
}

/** Records enqueued media ids so tests can assert a thumbnail job was queued. */
export class FakeThumbnailQueue implements ThumbnailQueuePort {
  readonly enqueued: string[] = [];

  async enqueue(mediaId: string): Promise<void> {
    this.enqueued.push(mediaId);
  }
}

export class FakeTenantContext implements TenantContextPort {
  constructor(private context: TenantRequestContext) {}

  run<T>(context: TenantRequestContext, callback: () => T): T {
    this.context = context;
    return callback();
  }

  getContext(): TenantRequestContext | undefined {
    return this.context;
  }

  getTenantIdOrThrow(): string {
    return this.context.tenantId;
  }

  getActor(): string {
    return this.context.actor;
  }

  setTenant(tenantId: string): void {
    this.context = { ...this.context, tenantId };
  }
}

/** Minimal ConfigService stand-in exposing only `getOrThrow` over a fixed map. */
export function fakeConfig(values: Record<string, unknown>): ConfigService {
  return {
    getOrThrow: <T>(key: string): T => {
      if (!(key in values)) {
        throw new Error(`missing config "${key}"`);
      }
      return values[key] as T;
    },
  } as unknown as ConfigService;
}
