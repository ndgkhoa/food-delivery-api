import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export type RevenueGranularity = 'day';

export class RevenueQueryRequest {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsIn(['day'])
  granularity: RevenueGranularity = 'day';
}
