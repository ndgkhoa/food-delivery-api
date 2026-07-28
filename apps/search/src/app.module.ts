import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import {
  createKafkaClient,
  KAFKA_CLIENT,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AutocompleteRestaurantsHandler } from '@search/application/restaurant-search/queries/autocomplete-restaurants.handler';
import { SearchRestaurantsHandler } from '@search/application/restaurant-search/queries/search-restaurants.handler';
import { searchEnvSchema } from '@search/config/search-env-schema';
import { RESTAURANT_SEARCH_REPOSITORY } from '@search/domain/restaurant-search/restaurant-search.repository';
import { ElasticsearchClientModule } from '@search/infrastructure/elasticsearch/elasticsearch-client.module';
import { ElasticsearchRestaurantSearchRepository } from '@search/infrastructure/elasticsearch/elasticsearch-restaurant-search.repository';
import { RestaurantIndexBootstrap } from '@search/infrastructure/elasticsearch/restaurant-index-bootstrap';
import { SearchController } from '@search/interface/http/search.controller';
import { CatalogProjectionConsumer } from '@search/interface/messaging/catalog-projection.consumer';

/**
 * Composition root: wires the domain search port to its Elasticsearch adapter,
 * registers the query handlers + read controller, and the `catalog.events`
 * projection consumer. The only file allowed to import across every layer — see
 * the hexagonal rules in `.dependency-cruiser.js`. No RolesGuard: search is a
 * public read surface (any authenticated tenant), scoped by the trusted identity.
 */
@Module({
  imports: [
    SharedConfigModule.forRoot(searchEnvSchema),
    SharedLoggingModule.forRoot(),
    TenancyModule,
    ElasticsearchClientModule,
  ],
  controllers: [SearchController],
  providers: [
    // Query use cases
    SearchRestaurantsHandler,
    AutocompleteRestaurantsHandler,
    // Search read-model port → Elasticsearch adapter
    {
      provide: RESTAURANT_SEARCH_REPOSITORY,
      useClass: ElasticsearchRestaurantSearchRepository,
    },
    // Provisions the `restaurants` index (create-if-absent) on boot
    RestaurantIndexBootstrap,
    // Projection: shared Kafka client + subscriber + the consumer that tails
    // catalog.events into the index (its own consumer group).
    {
      provide: KAFKA_CLIENT,
      useFactory: (config: ConfigService) =>
        createKafkaClient({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
        }),
      inject: [ConfigService],
    },
    KafkaConsumerSubscriber,
    CatalogProjectionConsumer,
    // Every route is tenant-scoped by default — the tenant comes from the verified
    // identity the gateway propagates (shared-tenancy), never a raw client header.
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
