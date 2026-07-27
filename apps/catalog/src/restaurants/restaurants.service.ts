import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import type { PaginatedResult, PaginationQueryDto } from '../common/pagination-query.dto';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { CreateRestaurantDto } from './dto/create-restaurant.dto';
import type { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { Restaurant } from './entities/restaurant.entity';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(Restaurant) private readonly restaurantRepository: Repository<Restaurant>,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateRestaurantDto): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = this.restaurantRepository.create({ ...dto, tenantId });
    const saved = await this.restaurantRepository.save(restaurant);

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity: 'restaurant',
      entityId: saved.id,
      after: saved,
    });

    return saved;
  }

  async findAll(pagination: PaginationQueryDto): Promise<PaginatedResult<Restaurant>> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const { page, limit } = pagination;

    const [data, total] = await this.restaurantRepository.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  /** Also used internally by `MenuItemsService` to 404 + tenant-scope-check the parent restaurant. */
  async findOne(id: string): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = await this.restaurantRepository.findOne({ where: { id, tenantId } });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant "${id}" not found`);
    }

    return restaurant;
  }

  async update(id: string, dto: UpdateRestaurantDto): Promise<Restaurant> {
    const before = await this.findOne(id);
    const merged = this.restaurantRepository.merge({ ...before }, dto);
    const saved = await this.restaurantRepository.save(merged);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity: 'restaurant',
      entityId: id,
      before,
      after: saved,
    });

    return saved;
  }

  async remove(id: string): Promise<void> {
    const before = await this.findOne(id);
    await this.restaurantRepository.softDelete({ id: before.id, tenantId: before.tenantId });

    await this.auditService.record({
      action: AuditAction.DELETE,
      entity: 'restaurant',
      entityId: id,
      before,
    });
  }
}
