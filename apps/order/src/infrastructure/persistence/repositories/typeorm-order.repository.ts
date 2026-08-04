import { readFromSlave } from '@food-delivery-api/shared-persistence';
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Order } from '@order/domain/order/order';
import type { OrderRepository } from '@order/domain/order/order.repository';
import { OrderConcurrencyConflictError, OrderNotFoundError } from '@order/domain/shared/errors';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';
import { OrderMapper } from '@order/infrastructure/persistence/mappers/order.mapper';
import { getTransactionalEntityManager } from '@order/infrastructure/persistence/transaction/transactional-entity-manager';
import { type DataSource, In, type Repository } from 'typeorm';

@Injectable()
export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderOrmEntity)
    private readonly ormOrderRepository: Repository<OrderOrmEntity>,
    @InjectRepository(OrderItemOrmEntity)
    private readonly ormOrderItemRepository: Repository<OrderItemOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

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

  async findRecentByTenant(tenantId: string, userId: string, limit: number): Promise<Order[]> {
    return readFromSlave(this.dataSource, async (manager) => {
      const orderRows = await manager.getRepository(OrderOrmEntity).find({
        where: { tenantId, userId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: limit,
      });
      if (orderRows.length === 0) {
        return [];
      }

      const itemRows = await manager.getRepository(OrderItemOrmEntity).find({
        where: { orderId: In(orderRows.map((row) => row.id)) },
      });
      const itemsByOrderId = new Map<string, OrderItemOrmEntity[]>();
      for (const item of itemRows) {
        const bucket = itemsByOrderId.get(item.orderId);
        if (bucket) {
          bucket.push(item);
        } else {
          itemsByOrderId.set(item.orderId, [item]);
        }
      }

      return orderRows.map((row) => OrderMapper.toDomain(row, itemsByOrderId.get(row.id) ?? []));
    });
  }
}
