import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NotificationChannel,
  NotificationMessage,
} from '@notification/domain/notification/notification-channel.port';
import { bodyFor, subjectFor } from '@notification/domain/notification/notification-copy';
import { createTransport, type Transporter } from 'nodemailer';

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
