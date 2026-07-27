import type { PageResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';
import type { TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';
import { TenantMapper } from '@auth/infrastructure/persistence/mappers/tenant.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmTenantRepository implements TenantRepository {
  constructor(
    @InjectRepository(TenantOrmEntity)
    private readonly ormRepository: Repository<TenantOrmEntity>,
  ) {}

  async save(tenant: Tenant): Promise<Tenant> {
    const saved = await this.ormRepository.save(TenantMapper.toOrm(tenant));
    return TenantMapper.toDomain(saved);
  }

  async findById(id: string): Promise<Tenant | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });
    return orm ? TenantMapper.toDomain(orm) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const orm = await this.ormRepository.findOne({ where: { slug } });
    return orm ? TenantMapper.toDomain(orm) : null;
  }

  async findAndCount(pagination: Pagination): Promise<PageResult<Tenant>> {
    const [rows, total] = await this.ormRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
    return { data: rows.map(TenantMapper.toDomain), total };
  }
}
