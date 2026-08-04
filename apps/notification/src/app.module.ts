import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { KafkaConsumerSubscriber, MessagingModule } from '@food-delivery-api/shared-messaging';
import { TenancyModule } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { DispatchOrderEventHandler } from '@notification/application/dispatch-order-event.handler';
import { HandleSendFailureHandler } from '@notification/application/handle-send-failure.handler';
import { SendNotificationHandler } from '@notification/application/send-notification.handler';
import { notificationEnvSchema } from '@notification/config/notification-env-schema';
import { RECIPIENT_RESOLVER } from '@notification/domain/notification/recipient-resolver.port';
import { NotificationChannelsModule } from '@notification/infrastructure/channels/notification-channels.module';
import { PersistenceModule } from '@notification/infrastructure/persistence/persistence.module';
import { NotificationQueueModule } from '@notification/infrastructure/queue/notification-queue.module';
import { RecipientResolverStub } from '@notification/infrastructure/recipient/recipient-resolver.stub';
import { OrderEventsConsumer } from '@notification/interface/messaging/order-events.consumer';
import { NotificationWorker } from '@notification/interface/queue/notification.worker';

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
