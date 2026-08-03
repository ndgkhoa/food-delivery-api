import { ConflictError } from '@auth/domain/shared/errors';
import type { PageResult, Pagination } from '@auth/domain/shared/pagination';
import type { Tenant } from '@auth/domain/tenant/tenant';
import type { TenantRepository } from '@auth/domain/tenant/tenant.repository';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';
import { TenantMapper } from '@auth/infrastructure/persistence/mappers/tenant.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class TypeOrmTenantRepository implements TenantRepository {
  constructor(
    @InjectRepository(TenantOrmEntity)
    private readonly ormRepository: Repository<TenantOrmEntity>,
  ) {}

  async save(tenant: Tenant): Promise<Tenant> {
    try {
      const saved = await this.ormRepository.save(TenantMapper.toOrm(tenant));
      return TenantMapper.toDomain(saved);
    } catch (error) {
      // The handler pre-checks the slug for the friendly path, but two concurrent
      // creates can both pass that check and race to the unique index. Translate
      // the DB unique violation to a domain ConflictError so the edge still maps
      // it to 409 instead of leaking a raw 500.
      const driverCode = (error as { driverError?: { code?: string } }).driverError?.code;
      if (error instanceof QueryFailedError && driverCode === PG_UNIQUE_VIOLATION) {
        throw new ConflictError(`Tenant slug "${tenant.slug}" is already taken`);
      }
      throw error;
    }
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
