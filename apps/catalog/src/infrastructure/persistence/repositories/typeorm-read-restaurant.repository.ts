import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { ReadRestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/read-restaurant.orm-entity';
import { ReadRestaurantMapper } from '@catalog/infrastructure/persistence/mappers/read-restaurant.mapper';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmReadRestaurantRepository implements ReadRestaurantRepository {
  constructor(
    @InjectRepository(ReadRestaurantOrmEntity)
    private readonly ormRepository: Repository<ReadRestaurantOrmEntity>,
  ) {}

  /** Enlists in the active transaction (the projection upsert) when one is open. */
  private get repository(): Repository<ReadRestaurantOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(ReadRestaurantOrmEntity) ?? this.ormRepository
    );
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const orm = await this.repository.findOne({ where: { id, tenantId } });
    return orm ? ReadRestaurantMapper.toDomain(orm) : null;
  }

  async findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>> {
    const [rows, total] = await this.repository.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
    return { data: rows.map(ReadRestaurantMapper.toDomain), total };
  }

  /** Idempotent upsert by PK so re-delivered projection events converge to the same row. */
  async upsert(row: ReadRestaurantRow): Promise<void> {
    await this.repository.upsert(ReadRestaurantMapper.toOrm(row), ['id']);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.repository.delete({ id, tenantId });
  }
}
