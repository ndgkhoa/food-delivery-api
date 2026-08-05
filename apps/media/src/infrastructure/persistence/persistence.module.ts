import { MEDIA_OBJECT_REPOSITORY } from '@media/domain/media/media-object.repository';
import { MediaObjectOrmEntity } from '@media/infrastructure/persistence/entities/media-object.orm-entity';
import { TypeOrmMediaObjectRepository } from '@media/infrastructure/persistence/repositories/typeorm-media-object.repository';
import { buildDataSourceOptions } from '@media/infrastructure/persistence/typeorm-options';
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
    TypeOrmModule.forFeature([MediaObjectOrmEntity]),
  ],
  providers: [{ provide: MEDIA_OBJECT_REPOSITORY, useClass: TypeOrmMediaObjectRepository }],
  exports: [MEDIA_OBJECT_REPOSITORY],
})
export class PersistenceModule {}
