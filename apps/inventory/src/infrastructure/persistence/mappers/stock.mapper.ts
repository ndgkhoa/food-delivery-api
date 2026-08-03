import { Stock } from '@inventory/domain/stock/stock';
import type { StockOrmEntity } from '@inventory/infrastructure/persistence/entities/stock.orm-entity';

export class StockMapper {
  static toDomain(orm: StockOrmEntity): Stock {
    return Stock.reconstitute({
      tenantId: orm.tenantId,
      itemId: orm.itemId,
      available: orm.available,
    });
  }
}
