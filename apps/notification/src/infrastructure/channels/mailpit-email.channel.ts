import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  NotificationMessage,
} from '@notification/domain/notification/notification-channel.port';
import { bodyFor, subjectFor } from '@notification/domain/notification/notification-copy';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Real SMTP send to Mailpit (dev inbox catcher) via nodemailer — the one
 * non-stub channel this slice ships. `MAIL_FROM` is the envelope sender; the
 * subject/body come from the deterministic templates so the e2e can assert
 * exact content in the captured message.
 */
@Injectable()
export class MailpitEmailChannel implements NotificationChannel {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    this.transporter = createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure: false,
    });
  }

  async send(message: NotificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.recipient,
      subject: subjectFor(message.type),
      text: bodyFor(message.type, message.data),
    });
  }
}
