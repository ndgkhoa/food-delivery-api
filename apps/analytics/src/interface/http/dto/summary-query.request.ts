import { IsISO8601 } from 'class-validator';

/** `GET /analytics/summary` query params. */
export class SummaryQueryRequest {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
