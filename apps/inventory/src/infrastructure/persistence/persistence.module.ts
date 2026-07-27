import { RESERVATION_REPOSITORY } from '@inventory/domain/reservation/reservation.repository';
import { TRANSACTION_PORT } from '@inventory/domain/shared/transaction.port';
import { STOCK_REPOSITORY } from '@inventory/domain/stock/stock.repository';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';
import { TypeOrmReservationRepository } from '@inventory/infrastructure/persistence/repositories/typeorm-reservation.repository';
import { TypeOrmStockRepository } from '@inventory/infrastructure/persistence/repositories/typeorm-stock.repository';
import { TypeOrmTransactionAdapter } from '@inventory/infrastructure/persistence/transaction/typeorm-transaction.adapter';
import { buildDataSourceOptions } from '@inventory/infrastructure/persistence/typeorm-options';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Owns the inventory Postgres connection + binds the domain repository ports to
 * their TypeORM adapters. Any module needing `STOCK_REPOSITORY` /
 * `RESERVATION_REPOSITORY` / `TRANSACTION_PORT` imports this module.
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
    TypeOrmModule.forFeature([StockOrmEntity, ReservationOrmEntity]),
  ],
  providers: [
    { provide: STOCK_REPOSITORY, useClass: TypeOrmStockRepository },
    { provide: RESERVATION_REPOSITORY, useClass: TypeOrmReservationRepository },
    { provide: TRANSACTION_PORT, useClass: TypeOrmTransactionAdapter },
  ],
  exports: [STOCK_REPOSITORY, RESERVATION_REPOSITORY, TRANSACTION_PORT],
})
export class PersistenceModule {}
