import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { KafkaConsumerSubscriber, MessagingModule } from '@food-delivery-api/shared-messaging';
import { TenancyModule } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { DispatchOrderEventHandler } from '@notification/application/dispatch-order-event.handler';
import { HandleSendFailureHandler } from '@notification/application/handle-send-failure.handler';
import { RecipientResolverStub } from '@notification/application/recipient-resolver.stub';
import { SendNotificationHandler } from '@notification/application/send-notification.handler';
import { notificationEnvSchema } from '@notification/config/notification-env-schema';
import { RECIPIENT_RESOLVER } from '@notification/domain/notification/recipient-resolver.port';
import { NotificationChannelsModule } from '@notification/infrastructure/channels/notification-channels.module';
import { PersistenceModule } from '@notification/infrastructure/persistence/persistence.module';
import { NotificationQueueModule } from '@notification/infrastructure/queue/notification-queue.module';
import { OrderEventsConsumer } from '@notification/interface/messaging/order-events.consumer';
import { NotificationWorker } from '@notification/interface/queue/notification.worker';

/**
 * Composition root for notification: config + persistence (notifications
 * ledger + dedupe store), tenancy (consume-time tenant scope), the Kafka
 * messaging edge (`order.events` consumer), the channel adapters (Mailpit
 * email + sms/push stubs), the BullMQ queue/DLQ producers, and the per-channel
 * workers. Otherwise headless — no public API; `HealthModule` adds only the
 * k8s liveness/readiness endpoint. `KafkaTopicAdmin` is not needed since this
 * service only consumes (never publishes to Kafka).
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(notificationEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    TenancyModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'notification',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
    NotificationChannelsModule,
    NotificationQueueModule,
  ],
  providers: [
    KafkaConsumerSubscriber,
    OrderEventsConsumer,
    NotificationWorker,
    DispatchOrderEventHandler,
    SendNotificationHandler,
    HandleSendFailureHandler,
    { provide: RECIPIENT_RESOLVER, useClass: RecipientResolverStub },
  ],
})
export class AppModule {}
