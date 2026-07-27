import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { RestaurantRepository } from '@catalog/domain/restaurant/restaurant.repository';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import { RestaurantMapper } from '@catalog/infrastructure/persistence/mappers/restaurant.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmRestaurantRepository implements RestaurantRepository {
  constructor(
    @InjectRepository(RestaurantOrmEntity)
    private readonly ormRepository: Repository<RestaurantOrmEntity>,
  ) {}

  async save(restaurant: Restaurant): Promise<Restaurant> {
    const orm = RestaurantMapper.toOrm(restaurant);
    const saved = await this.ormRepository.save(orm);
    return RestaurantMapper.toDomain(saved);
  }

  async findById(id: string, tenantId: string): Promise<Restaurant | null> {
    const orm = await this.ormRepository.findOne({ where: { id, tenantId } });
    return orm ? RestaurantMapper.toDomain(orm) : null;
  }

  async findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>> {
    const [rows, total] = await this.ormRepository.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return { data: rows.map(RestaurantMapper.toDomain), total };
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.ormRepository.softDelete({ id, tenantId });
  }
}
