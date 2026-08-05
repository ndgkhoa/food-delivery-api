import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationChannel,
  NotificationMessage,
} from '@notification/domain/notification/notification-channel.port';

@Injectable()
export class LogSmsChannel implements NotificationChannel {
  private readonly logger = new Logger(LogSmsChannel.name);

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(`[stub-sms] to=${message.recipient} type=${message.type}`);
  }
}
