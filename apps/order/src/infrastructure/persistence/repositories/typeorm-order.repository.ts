import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import { OrderConcurrencyConflictError, OrderNotFoundError } from '@order/domain/shared/errors';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';
import { OrderMapper } from '@order/infrastructure/persistence/mappers/order.mapper';
import { getTransactionalEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderOrmEntity)
    private readonly ormOrderRepository: Repository<OrderOrmEntity>,
    @InjectRepository(OrderItemOrmEntity)
    private readonly ormOrderItemRepository: Repository<OrderItemOrmEntity>,
  ) {}

  /** Enlists in the active transaction when one is open, else the default connection. */
  private get orderRepository(): Repository<OrderOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(OrderOrmEntity) ?? this.ormOrderRepository
    );
  }

  private get orderItemRepository(): Repository<OrderItemOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(OrderItemOrmEntity) ??
      this.ormOrderItemRepository
    );
  }

  async findById(tenantId: string, id: string): Promise<Order | undefined> {
    const row = await this.orderRepository.findOne({ where: { id, tenantId } });
    if (!row) {
      return undefined;
    }
    const items = await this.orderItemRepository.find({ where: { orderId: id } });
    return OrderMapper.toDomain(row, items);
  }

  async insert(order: Order): Promise<Order> {
    const savedOrder = await this.orderRepository.save(OrderMapper.toNewOrderOrm(order));
    const itemRows = OrderMapper.toNewOrderItemOrms(order);
    const savedItems = itemRows.length > 0 ? await this.orderItemRepository.save(itemRows) : [];
    return OrderMapper.toDomain(savedOrder, savedItems);
  }

  /**
   * Optimistic-lock transition: an atomic conditional `UPDATE ... WHERE id = :id
   * AND tenant_id = :tenantId AND version = :version` that also bumps the
   * version. Zero affected rows means a concurrent writer already moved the
   * version on since this aggregate was loaded — a real conflict, not a
   * missing row (the row was loaded moments earlier in the same use case).
   */
  async updateStatus(order: Order): Promise<Order> {
    const result = await this.orderRepository
      .createQueryBuilder()
      .update(OrderOrmEntity)
      .set({ status: order.status, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('id = :id AND tenant_id = :tenantId AND version = :version', {
        id: order.id,
        tenantId: order.tenantId,
        version: order.version,
      })
      .execute();

    if ((result.affected ?? 0) === 0) {
      throw new OrderConcurrencyConflictError(order.id);
    }

    const reloaded = await this.orderRepository.findOne({
      where: { id: order.id, tenantId: order.tenantId },
    });
    if (!reloaded) {
      throw new OrderNotFoundError(order.id);
    }
    const items = await this.orderItemRepository.find({ where: { orderId: order.id } });
    return OrderMapper.toDomain(reloaded, items);
  }
}
