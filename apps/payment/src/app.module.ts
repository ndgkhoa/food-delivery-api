import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
  MessagingModule,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { paymentEnvSchema } from '@payment/config/payment-env-schema';
import { PersistenceModule } from '@payment/infrastructure/persistence/persistence.module';
import { TemporalClientModule } from '@payment/infrastructure/temporal/temporal-client.module';
import { PaymentWebhookController } from '@payment/interface/http/payment-webhook.controller';
import { PaymentCommandConsumer } from '@payment/interface/messaging/payment-command.consumer';
import { PaymentOutboxRelayProvider } from '@payment/interface/messaging/payment-outbox-relay.provider';

@Module({
  imports: [
    SharedConfigModule.forRoot(paymentEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    TenancyModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'payment',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
    TemporalClientModule,
  ],
  controllers: [PaymentWebhookController],
  providers: [
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    PaymentCommandConsumer,
    PaymentOutboxRelayProvider,
  ],
})
export class AppModule {}
