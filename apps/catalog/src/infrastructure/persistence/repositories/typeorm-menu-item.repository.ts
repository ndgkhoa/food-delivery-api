import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { MenuItemRepository } from '@catalog/domain/menu-item/menu-item.repository';
import { ConcurrencyConflictError, EntityNotFoundError } from '@catalog/domain/shared/errors';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';
import { MenuItemOrmEntity } from '@catalog/infrastructure/persistence/entities/menu-item.orm-entity';
import { MenuItemMapper } from '@catalog/infrastructure/persistence/mappers/menu-item.mapper';
import { getTransactionalEntityManager } from '@catalog/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

@Injectable()
export class TypeOrmMenuItemRepository implements MenuItemRepository {
  constructor(
    @InjectRepository(MenuItemOrmEntity)
    private readonly ormRepository: Repository<MenuItemOrmEntity>,
  ) {}

  private get repository(): Repository<MenuItemOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(MenuItemOrmEntity) ?? this.ormRepository;
  }

  async save(menuItem: MenuItem): Promise<MenuItem> {
    const orm = MenuItemMapper.toOrm(menuItem);
    const saved = await this.repository.save(orm);
    return MenuItemMapper.toDomain(saved);
  }

  async updateVersioned(menuItem: MenuItem): Promise<MenuItem> {
    const result = await this.repository
      .createQueryBuilder()
      .update(MenuItemOrmEntity)
      .set({
        name: menuItem.name,
        description: menuItem.description,
        priceCents: menuItem.priceCents,
        isAvailable: menuItem.isAvailable,
        updatedAt: menuItem.updatedAt,
        version: () => 'version + 1',
      })
      .where(
        'id = :id AND restaurant_id = :restaurantId AND tenant_id = :tenantId AND version = :version',
        {
          id: menuItem.id,
          restaurantId: menuItem.restaurantId,
          tenantId: menuItem.tenantId,
          version: menuItem.version,
        },
      )
      .execute();

    if ((result.affected ?? 0) === 0) {
      throw new ConcurrencyConflictError('MenuItem', menuItem.id);
    }

    const reloaded = await this.repository.findOne({
      where: { id: menuItem.id, restaurantId: menuItem.restaurantId, tenantId: menuItem.tenantId },
    });
    if (!reloaded) {
      throw new EntityNotFoundError('MenuItem', menuItem.id);
    }
    return MenuItemMapper.toDomain(reloaded);
  }

  async findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null> {
    const orm = await this.repository.findOne({ where: { id, restaurantId, tenantId } });
    return orm ? MenuItemMapper.toDomain(orm) : null;
  }

  async findManyByIds(ids: string[], tenantId: string): Promise<MenuItem[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.repository.find({ where: { id: In(ids), tenantId } });
    return rows.map(MenuItemMapper.toDomain);
  }

  async findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>> {
    const [rows, total] = await this.repository.findAndCount({
      where: { tenantId, restaurantId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return { data: rows.map(MenuItemMapper.toDomain), total };
  }

  async findAllByRestaurant(restaurantId: string, tenantId: string): Promise<MenuItem[]> {
    const rows = await this.repository.find({ where: { restaurantId, tenantId } });
    return rows.map(MenuItemMapper.toDomain);
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.repository.softDelete({ id, tenantId });
  }

  async softDeleteByRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    await this.repository.softDelete({ restaurantId, tenantId });
  }
}
