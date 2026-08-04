import { TENANT_REPOSITORY } from '@auth/domain/tenant/tenant.repository';
import { USER_TENANT_LINK_REPOSITORY } from '@auth/domain/tenant/user-tenant-link.repository';
import { TenantOrmEntity } from '@auth/infrastructure/persistence/entities/tenant.orm-entity';
import { UserTenantMapOrmEntity } from '@auth/infrastructure/persistence/entities/user-tenant-map.orm-entity';
import { TypeOrmTenantRepository } from '@auth/infrastructure/persistence/repositories/typeorm-tenant.repository';
import { TypeOrmUserTenantLinkRepository } from '@auth/infrastructure/persistence/repositories/typeorm-user-tenant-link.repository';
import { buildDataSourceOptions } from '@auth/infrastructure/persistence/typeorm-options';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions({
          DB_HOST: config.getOrThrow<string>('DB_HOST'),
          DB_PORT: config.getOrThrow<number>('DB_PORT'),
          DB_USERNAME: config.getOrThrow<string>('DB_USERNAME'),
          DB_PASSWORD: config.getOrThrow<string>('DB_PASSWORD'),
          DB_NAME: config.getOrThrow<string>('DB_NAME'),
        }),
    }),
    TypeOrmModule.forFeature([TenantOrmEntity, UserTenantMapOrmEntity]),
  ],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: TypeOrmTenantRepository },
    { provide: USER_TENANT_LINK_REPOSITORY, useClass: TypeOrmUserTenantLinkRepository },
  ],
  exports: [TENANT_REPOSITORY, USER_TENANT_LINK_REPOSITORY],
})
export class PersistenceModule {}
