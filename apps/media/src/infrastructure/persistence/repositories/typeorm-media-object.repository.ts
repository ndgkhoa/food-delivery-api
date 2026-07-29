import type { MediaObject } from '@media/domain/media/media-object';
import type { MediaObjectRepository } from '@media/domain/media/media-object.repository';
import { MediaObjectOrmEntity } from '@media/infrastructure/persistence/entities/media-object.orm-entity';
import { MediaObjectMapper } from '@media/infrastructure/persistence/mappers/media-object.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmMediaObjectRepository implements MediaObjectRepository {
  constructor(
    @InjectRepository(MediaObjectOrmEntity)
    private readonly ormRepository: Repository<MediaObjectOrmEntity>,
  ) {}

  async save(media: MediaObject): Promise<MediaObject> {
    const saved = await this.ormRepository.save(MediaObjectMapper.toOrm(media));
    return MediaObjectMapper.toDomain(saved);
  }

  async findById(id: string, tenantId: string): Promise<MediaObject | null> {
    const orm = await this.ormRepository.findOne({ where: { id, tenantId } });
    return orm ? MediaObjectMapper.toDomain(orm) : null;
  }

  async findByIdForProcessing(id: string): Promise<MediaObject | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });
    return orm ? MediaObjectMapper.toDomain(orm) : null;
  }
}
