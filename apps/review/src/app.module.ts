import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  KafkaConsumerSubscriber,
  KafkaTopicAdmin,
  MessagingModule,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RecordReviewEligibilityHandler } from '@review/application/record-review-eligibility.handler';
import { SubmitReviewHandler } from '@review/application/submit-review.handler';
import { reviewEnvSchema } from '@review/config/review-env-schema';
import { PersistenceModule } from '@review/infrastructure/persistence/persistence.module';
import { ReviewsController } from '@review/interface/http/reviews.controller';
import { OrderEventsConsumer } from '@review/interface/messaging/order-events.consumer';
import { ReviewOutboxRelayProvider } from '@review/interface/messaging/review-outbox-relay.provider';

@Module({
  imports: [
    SharedConfigModule.forRoot(reviewEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    PersistenceModule,
    TenancyModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'review',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [ReviewsController],
  providers: [
    SubmitReviewHandler,
    RecordReviewEligibilityHandler,
    KafkaConsumerSubscriber,
    KafkaTopicAdmin,
    OrderEventsConsumer,
    ReviewOutboxRelayProvider,
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
