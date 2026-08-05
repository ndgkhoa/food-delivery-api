import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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
