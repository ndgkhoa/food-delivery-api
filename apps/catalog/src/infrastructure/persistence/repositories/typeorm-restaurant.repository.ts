import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { Restaurant } from '../../../domain/restaurant/restaurant';
import type { RestaurantRepository } from '../../../domain/restaurant/restaurant.repository';
import type { PageResult, Pagination } from '../../../domain/shared/pagination';
import { RestaurantOrmEntity } from '../entities/restaurant.orm-entity';
import { RestaurantMapper } from '../mappers/restaurant.mapper';

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
