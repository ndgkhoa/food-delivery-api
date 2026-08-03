import { MediaObject, type MediaStatus } from '@media/domain/media/media-object';
import { MediaObjectOrmEntity } from '@media/infrastructure/persistence/entities/media-object.orm-entity';

export class MediaObjectMapper {
  static toDomain(orm: MediaObjectOrmEntity): MediaObject {
    return MediaObject.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      objectKey: orm.objectKey,
      contentType: orm.contentType,
      sizeBytes: Number(orm.sizeBytes),
      status: orm.status as MediaStatus,
      thumbnailKey: orm.thumbnailKey,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: MediaObject): MediaObjectOrmEntity {
    const orm = new MediaObjectOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.objectKey = domain.objectKey;
    orm.contentType = domain.contentType;
    orm.sizeBytes = String(domain.sizeBytes);
    orm.status = domain.status;
    orm.thumbnailKey = domain.thumbnailKey;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
