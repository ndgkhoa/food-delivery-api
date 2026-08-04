import { IsISO8601 } from 'class-validator';

export class SummaryQueryRequest {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
