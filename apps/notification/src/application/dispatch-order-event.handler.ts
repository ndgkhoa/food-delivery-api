import {
  type EventEnvelopeHeaders,
  IdempotentConsumer,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CHANNEL_NAMES,
  type ChannelName,
  type NewNotification,
} from '@notification/domain/notification/notification';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '@notification/domain/notification/notification.repository';
import {
  NOTIFICATION_QUEUE,
  type NotificationQueuePort,
} from '@notification/domain/notification/notification-queue.port';
import {
  RECIPIENT_RESOLVER,
  type Recipient,
  type RecipientResolverPort,
} from '@notification/domain/notification/recipient-resolver.port';
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@notification/domain/shared/transaction.port';

export const ORDER_CONFIRMED = 'OrderConfirmed';
export const ORDER_CANCELLED = 'OrderCancelled';

export interface OrderLifecyclePayload {
  orderId: string;
  userId: string;
}

const NOTIFICATION_TYPE: Record<string, string> = {
  [ORDER_CONFIRMED]: 'order-confirmed',
  [ORDER_CANCELLED]: 'order-cancelled',
};

function recipientFor(channel: ChannelName, recipient: Recipient): string {
  switch (channel) {
    case 'email':
      return recipient.email;
    case 'sms':
      return recipient.phone;
    case 'push':
      return recipient.pushToken;
  }
}

@Injectable()
export class DispatchOrderEventHandler {
  private readonly logger = new Logger(DispatchOrderEventHandler.name);
  private readonly enabledChannels: ChannelName[];

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepository,
    @Inject(RECIPIENT_RESOLVER) private readonly recipientResolver: RecipientResolverPort,
    @Inject(NOTIFICATION_QUEUE) private readonly queue: NotificationQueuePort,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    config: ConfigService,
  ) {
    this.enabledChannels = CHANNEL_NAMES.filter((channel) =>
      config.getOrThrow<boolean>(`NOTIFY_${channel.toUpperCase()}_ENABLED`),
    );
  }

  async execute(envelope: EventEnvelopeHeaders, payload: OrderLifecyclePayload): Promise<void> {
    const type = NOTIFICATION_TYPE[envelope.eventType];
    if (!type) {
      this.logger.warn(`Ignoring unknown order event type "${envelope.eventType}"`);
      return;
    }
    if (this.enabledChannels.length === 0) {
      return;
    }

    const recipient = await this.recipientResolver.resolve(payload.userId);
    const rows: NewNotification[] = this.enabledChannels.map((channel) => ({
      tenantId: envelope.tenantId,
      eventId: envelope.eventId,
      channel,
      recipient: recipientFor(channel, recipient),
      type,
    }));

    await this.transaction.runInTransaction(() =>
      IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
        this.repository.createPendingBatch(rows),
      ),
    );

    const pending = await this.repository.findPendingByEvent(envelope.tenantId, envelope.eventId);
    for (const notification of pending) {
      await this.queue.enqueue(notification.channel, {
        notificationId: notification.id,
        channel: notification.channel,
        type: notification.type,
        recipient: notification.recipient,
        tenantId: notification.tenantId,
        data: { orderId: payload.orderId },
      });
    }
  }
}
