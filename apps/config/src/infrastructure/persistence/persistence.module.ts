import { CONFIG_ENTRY_REPOSITORY } from '@config/domain/config/config-entry.repository';
import { FEATURE_FLAG_REPOSITORY } from '@config/domain/config/feature-flag.repository';
import { ConfigEntryOrmEntity } from '@config/infrastructure/persistence/entities/config-entry.orm-entity';
import { FeatureFlagOrmEntity } from '@config/infrastructure/persistence/entities/feature-flag.orm-entity';
import { TypeOrmConfigEntryRepository } from '@config/infrastructure/persistence/repositories/typeorm-config-entry.repository';
import { TypeOrmFeatureFlagRepository } from '@config/infrastructure/persistence/repositories/typeorm-feature-flag.repository';
import { buildDataSourceOptions } from '@config/infrastructure/persistence/typeorm-options';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Owns the Postgres connection and binds the config-entry/feature-flag
 * repository ports to their TypeORM adapters. Any module needing these ports
 * imports this one.
 */
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
    TypeOrmModule.forFeature([ConfigEntryOrmEntity, FeatureFlagOrmEntity]),
  ],
  providers: [
    { provide: CONFIG_ENTRY_REPOSITORY, useClass: TypeOrmConfigEntryRepository },
    { provide: FEATURE_FLAG_REPOSITORY, useClass: TypeOrmFeatureFlagRepository },
  ],
  exports: [CONFIG_ENTRY_REPOSITORY, FEATURE_FLAG_REPOSITORY],
})
export class PersistenceModule {}
