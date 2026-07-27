import type { UserTenantLink } from '@auth/domain/tenant/user-tenant-link';
import type { UserTenantLinkRepository } from '@auth/domain/tenant/user-tenant-link.repository';
import { UserTenantMapOrmEntity } from '@auth/infrastructure/persistence/entities/user-tenant-map.orm-entity';
import { UserTenantLinkMapper } from '@auth/infrastructure/persistence/mappers/user-tenant-link.mapper';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmUserTenantLinkRepository implements UserTenantLinkRepository {
  constructor(
    @InjectRepository(UserTenantMapOrmEntity)
    private readonly ormRepository: Repository<UserTenantMapOrmEntity>,
  ) {}

  async save(link: UserTenantLink): Promise<UserTenantLink> {
    const saved = await this.ormRepository.save(UserTenantLinkMapper.toOrm(link));
    return UserTenantLinkMapper.toDomain(saved);
  }

  async findByKeycloakUserId(keycloakUserId: string): Promise<UserTenantLink | null> {
    const orm = await this.ormRepository.findOne({ where: { keycloakUserId } });
    return orm ? UserTenantLinkMapper.toDomain(orm) : null;
  }
}
