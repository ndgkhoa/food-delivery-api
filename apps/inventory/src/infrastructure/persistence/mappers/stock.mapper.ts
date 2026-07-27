import { Stock } from '@inventory/domain/stock/stock';
import { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';

export class StockMapper {
  static toDomain(orm: StockOrmEntity): Stock {
    return Stock.reconstitute({
      tenantId: orm.tenantId,
      itemId: orm.itemId,
      available: orm.available,
    });
  }

  static toOrm(domain: Stock): StockOrmEntity {
    const orm = new StockOrmEntity();
    orm.tenantId = domain.tenantId;
    orm.itemId = domain.itemId;
    orm.available = domain.available;
    return orm;
  }
}
