import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationChannel,
  NotificationMessage,
} from '@notification/domain/notification/notification-channel.port';

/**
 * STUB push channel: logs deterministically instead of calling a real
 * provider. A real FCM (or similar) adapter lands later behind this same
 * `NotificationChannel` port — no consumer/worker change required.
 */
@Injectable()
export class LogPushChannel implements NotificationChannel {
  private readonly logger = new Logger(LogPushChannel.name);

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(`[stub-push] to=${message.recipient} type=${message.type}`);
  }
}
