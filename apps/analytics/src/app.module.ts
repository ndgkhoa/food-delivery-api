import { IngestOrderEventHandler } from '@analytics/application/ingest-order-event.handler';
import { GetRevenueSeriesHandler } from '@analytics/application/queries/get-revenue-series.handler';
import { GetSummaryHandler } from '@analytics/application/queries/get-summary.handler';
import { GetTopRestaurantsHandler } from '@analytics/application/queries/get-top-restaurants.handler';
import { analyticsEnvSchema } from '@analytics/config/analytics-env-schema';
import { REVENUE_SERIES_QUERY } from '@analytics/domain/analytics-query/revenue-series-query.port';
import { SUMMARY_QUERY } from '@analytics/domain/analytics-query/summary-query.port';
import { TOP_RESTAURANTS_QUERY } from '@analytics/domain/analytics-query/top-restaurants-query.port';
import { ORDERS_FACT_WRITER } from '@analytics/domain/orders-fact/orders-fact-writer.port';
import { ClickHouseClientModule } from '@analytics/infrastructure/clickhouse/clickhouse-client.module';
import { ClickHouseOrdersFactWriterAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-orders-fact-writer.adapter';
import { ClickHouseRevenueSeriesQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-revenue-series-query.adapter';
import { ClickHouseSummaryQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-summary-query.adapter';
import { ClickHouseTopRestaurantsQueryAdapter } from '@analytics/infrastructure/clickhouse/clickhouse-top-restaurants-query.adapter';
import { OrdersFactSchemaBootstrap } from '@analytics/infrastructure/clickhouse/orders-fact-schema-bootstrap';
import { AnalyticsController } from '@analytics/interface/http/analytics.controller';
import { OrderEventsConsumer } from '@analytics/interface/messaging/order-events.consumer';
import { SharedConfigModule } from '@food-delivery-api/shared-config';
import { HealthModule } from '@food-delivery-api/shared-health';
import { SharedLoggingModule } from '@food-delivery-api/shared-logging';
import { KafkaConsumerSubscriber, MessagingModule } from '@food-delivery-api/shared-messaging';
import { TenancyModule, TrustedIdentityInterceptor } from '@food-delivery-api/shared-tenancy';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    SharedConfigModule.forRoot(analyticsEnvSchema),
    SharedLoggingModule.forRoot(),
    HealthModule,
    TenancyModule,
    ClickHouseClientModule,
    MessagingModule.forRoot({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'analytics',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    }),
  ],
  controllers: [AnalyticsController],
  providers: [
    GetRevenueSeriesHandler,
    GetTopRestaurantsHandler,
    GetSummaryHandler,
    IngestOrderEventHandler,
    OrdersFactSchemaBootstrap,
    { provide: ORDERS_FACT_WRITER, useClass: ClickHouseOrdersFactWriterAdapter },
    { provide: REVENUE_SERIES_QUERY, useClass: ClickHouseRevenueSeriesQueryAdapter },
    { provide: TOP_RESTAURANTS_QUERY, useClass: ClickHouseTopRestaurantsQueryAdapter },
    { provide: SUMMARY_QUERY, useClass: ClickHouseSummaryQueryAdapter },
    KafkaConsumerSubscriber,
    OrderEventsConsumer,
    { provide: APP_INTERCEPTOR, useClass: TrustedIdentityInterceptor },
  ],
})
export class AppModule {}
