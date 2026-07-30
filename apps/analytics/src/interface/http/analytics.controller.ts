import { GetRevenueSeriesHandler } from '@analytics/application/queries/get-revenue-series.handler';
import { GetSummaryHandler } from '@analytics/application/queries/get-summary.handler';
import { GetTopRestaurantsHandler } from '@analytics/application/queries/get-top-restaurants.handler';
import type { RevenuePointResponse } from '@analytics/interface/http/dto/revenue.response';
import { RevenueQueryRequest } from '@analytics/interface/http/dto/revenue-query.request';
import type { SummaryResponse } from '@analytics/interface/http/dto/summary.response';
import { SummaryQueryRequest } from '@analytics/interface/http/dto/summary-query.request';
import type { TopRestaurantResponse } from '@analytics/interface/http/dto/top-restaurants.response';
import { TopRestaurantsQueryRequest } from '@analytics/interface/http/dto/top-restaurants-query.request';
import { Controller, Get, Query } from '@nestjs/common';

/**
 * Read-only dashboard API: every route is tenant-scoped from the trusted
 * identity the gateway verified and propagated (never a raw client header),
 * so a caller only ever sees its own tenant's aggregates. No write routes —
 * analytics never mutates business state.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly getRevenueSeries: GetRevenueSeriesHandler,
    private readonly getTopRestaurants: GetTopRestaurantsHandler,
    private readonly getSummary: GetSummaryHandler,
  ) {}

  @Get('revenue')
  revenue(@Query() dto: RevenueQueryRequest): Promise<RevenuePointResponse[]> {
    return this.getRevenueSeries.execute({ from: dto.from, to: dto.to });
  }

  @Get('top-restaurants')
  topRestaurants(@Query() dto: TopRestaurantsQueryRequest): Promise<TopRestaurantResponse[]> {
    return this.getTopRestaurants.execute({ from: dto.from, to: dto.to, limit: dto.limit });
  }

  @Get('summary')
  summary(@Query() dto: SummaryQueryRequest): Promise<SummaryResponse> {
    return this.getSummary.execute({ from: dto.from, to: dto.to });
  }
}
