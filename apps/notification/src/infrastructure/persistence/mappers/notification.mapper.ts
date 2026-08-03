import type { Notification } from '@notification/domain/notification/notification';
import type { NotificationOrmEntity } from '@notification/infrastructure/persistence/entities/notification.orm-entity';

export function toDomain(entity: NotificationOrmEntity): Notification {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    eventId: entity.eventId,
    channel: entity.channel,
    recipient: entity.recipient,
    type: entity.type,
    status: entity.status,
    attempts: entity.attempts,
    error: entity.error,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
