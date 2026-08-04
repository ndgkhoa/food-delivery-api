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

  async upsert(row: ReadRestaurantRow): Promise<void> {
    const orm = ReadRestaurantMapper.toOrm(row);
    await this.repository.manager.query(
      `INSERT INTO "read_restaurants"
         (id, tenant_id, name, description, is_active, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         is_active = EXCLUDED.is_active,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
      [
        orm.id,
        orm.tenantId,
        orm.name,
        orm.description,
        orm.isActive,
        orm.version,
        orm.createdAt,
        orm.updatedAt,
      ],
    );
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.repository.delete({ id, tenantId });
  }

  async updateRating(
    id: string,
    tenantId: string,
    rating: number,
    reviewCount: number,
  ): Promise<void> {
    await this.repository.update({ id, tenantId }, { rating, reviewCount });
  }
}
