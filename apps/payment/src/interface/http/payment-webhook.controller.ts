import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKFLOW_GATEWAY,
  type WorkflowGatewayPort,
} from '@payment/domain/shared/workflow-gateway.port';
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@payment/interface/http/hmac-webhook-verifier';
import { PaymentWebhookDto } from '@payment/interface/http/payment-webhook.dto';
import type { Request } from 'express';

@Controller('payment')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    @Inject(WORKFLOW_GATEWAY) private readonly workflowGateway: WorkflowGatewayPort,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: PaymentWebhookDto,
  ): Promise<{ status: string }> {
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const verification = verifyWebhookSignature({
      secret: this.config.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET'),
      rawBody,
      signatureHeader: this.headerValue(req, WEBHOOK_SIGNATURE_HEADER),
      timestampHeader: this.headerValue(req, WEBHOOK_TIMESTAMP_HEADER),
    });

    if (!verification.valid) {
      this.logger.warn(`Rejected payment webhook: ${verification.reason}`);
      throw new UnauthorizedException('invalid webhook signature');
    }

    await this.workflowGateway.signalProviderResult(body.orderId, {
      ok: body.ok,
      reason: body.reason,
    });
    return { status: 'accepted' };
  }

  private headerValue(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
