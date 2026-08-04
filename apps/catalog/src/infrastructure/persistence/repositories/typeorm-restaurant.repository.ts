import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { RestaurantRepository } from '@catalog/domain/restaurant/restaurant.repository';
import { ConcurrencyConflictError, EntityNotFoundError } from '@catalog/domain/shared/errors';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { RestaurantMapper } from '@catalog/infrastructure/persistence/mappers/restaurant.mapper';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmRestaurantRepository implements RestaurantRepository {
  constructor(
    @InjectRepository(RestaurantOrmEntity)
    private readonly ormRepository: Repository<RestaurantOrmEntity>,
  ) {}

  private get repository(): Repository<RestaurantOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(RestaurantOrmEntity) ?? this.ormRepository
    );
  }

  async save(restaurant: Restaurant): Promise<Restaurant> {
    const orm = RestaurantMapper.toOrm(restaurant);
    const saved = await this.repository.save(orm);
    return RestaurantMapper.toDomain(saved);
  }

  async updateVersioned(restaurant: Restaurant): Promise<Restaurant> {
    const result = await this.repository
      .createQueryBuilder()
      .update(RestaurantOrmEntity)
      .set({
        name: restaurant.name,
        description: restaurant.description,
        isActive: restaurant.isActive,
        updatedAt: restaurant.updatedAt,
        version: () => 'version + 1',
      })
      .where('id = :id AND tenant_id = :tenantId AND version = :version', {
        id: restaurant.id,
        tenantId: restaurant.tenantId,
        version: restaurant.version,
      })
      .execute();

    if ((result.affected ?? 0) === 0) {
      throw new ConcurrencyConflictError('Restaurant', restaurant.id);
    }

    const reloaded = await this.repository.findOne({
      where: { id: restaurant.id, tenantId: restaurant.tenantId },
    });
    if (!reloaded) {
      throw new EntityNotFoundError('Restaurant', restaurant.id);
    }
    return RestaurantMapper.toDomain(reloaded);
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const orm = await this.repository.findOne({ where: { id, tenantId } });
    return orm ? RestaurantMapper.toDomain(orm) : null;
  }

  async findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>> {
    const [rows, total] = await this.repository.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return { data: rows.map(RestaurantMapper.toDomain), total };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.repository.softDelete({ id, tenantId });
  }
}
