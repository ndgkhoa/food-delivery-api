import type { Reservation } from '@inventory/domain/reservation/reservation';
import type { ReservationRepository } from '@inventory/domain/reservation/reservation.repository';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';
import { ReservationMapper } from '@inventory/infrastructure/persistence/mappers/reservation.mapper';
import { getTransactionalEntityManager } from '@inventory/infrastructure/persistence/transaction/transactional-entity-manager';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

@Injectable()
export class TypeOrmReservationRepository implements ReservationRepository {
  constructor(
    @InjectRepository(ReservationOrmEntity)
    private readonly ormRepository: Repository<ReservationOrmEntity>,
  ) {}

  private get repository(): Repository<ReservationOrmEntity> {
    return (
      getTransactionalEntityManager()?.getRepository(ReservationOrmEntity) ?? this.ormRepository
    );
  }

  async save(reservation: Reservation): Promise<Reservation> {
    const saved = await this.repository.save(ReservationMapper.toOrm(reservation));
    return ReservationMapper.toDomain(saved);
  }

  async findActiveByOrder(tenantId: string, orderId: string): Promise<Reservation[]> {
    const rows = await this.repository.find({
      where: { tenantId, orderId, status: 'ACTIVE' },
    });
    return rows.map(ReservationMapper.toDomain);
  }

  async releaseIfActive(reservation: Reservation): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(ReservationOrmEntity)
      .set({ status: 'RELEASED', updatedAt: () => 'now()' })
      .where('id = :id AND status = :active', { id: reservation.id, active: 'ACTIVE' })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
