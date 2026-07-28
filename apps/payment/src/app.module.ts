import { SharedConfigModule } from '@food-delivery-api/shared-config';
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
import { PaymentCommandConsumer } from '@payment/interface/messaging/payment-command.consumer';
import { PaymentOutboxRelayProvider } from '@payment/interface/messaging/payment-outbox-relay.provider';

/**
 * Composition root for the payment STUB — a Kafka-only worker (no HTTP/gRPC).
 * Wires config + persistence (outbox + dedupe ledger only), tenancy (for the
 * consume-time tenant scope), and the messaging edge: the command consumer that
 * applies the deterministic charge rule and the reply outbox relay.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(paymentEnvSchema),
    SharedLoggingModule.forRoot(),
    PersistenceModule,
    TenancyModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'payment',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  providers: [
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    PaymentCommandConsumer,
    PaymentOutboxRelayProvider,
  ],
})
export class AppModule {}
