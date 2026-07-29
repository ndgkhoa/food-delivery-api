import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of a provider webhook callback reconciling an async charge result. */
export class PaymentWebhookDto {
  @IsString()
  @MaxLength(200)
  orderId!: string;

  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
