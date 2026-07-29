import {
  DuplicateEventError,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ProcessedEventOrmEntity } from '@notification/infrastructure/persistence/entities/processed-event.orm-entity';
import { getTransactionalEntityManager } from '@notification/infrastructure/persistence/transaction/transactional-entity-manager';
import type { Repository } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; driverError?: { code?: string } })?.code;
  const driverCode = (error as { driverError?: { code?: string } })?.driverError?.code;
  return code === UNIQUE_VIOLATION || driverCode === UNIQUE_VIOLATION;
}

/**
 * Records consumed `order.events` event ids in the same transaction as the
 * notification row batch. A re-delivered event's insert collides on the PK;
 * that unique-violation is translated into `DuplicateEventError` so the
 * idempotent consumer skips re-dispatching.
 */
@Injectable()
export class TypeOrmProcessedEventStore implements ProcessedEventStorePort {
  constructor(
    @InjectRepository(ProcessedEventOrmEntity)
    private readonly store: Repository<ProcessedEventOrmEntity>,
  ) {}

  private get repository(): Repository<ProcessedEventOrmEntity> {
    return getTransactionalEntityManager()?.getRepository(ProcessedEventOrmEntity) ?? this.store;
  }

  async markProcessed(_tx: unknown, eventId: string): Promise<void> {
    try {
      await this.repository.insert({ eventId });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEventError(eventId);
      }
      throw error;
    }
  }
}
