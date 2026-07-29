import { Module } from '@nestjs/common';
import {
  EMAIL_CHANNEL,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationChannelMap,
  PUSH_CHANNEL,
  SMS_CHANNEL,
} from '@notification/domain/notification/notification-channel.port';
import { LogPushChannel } from '@notification/infrastructure/channels/log-push.channel';
import { LogSmsChannel } from '@notification/infrastructure/channels/log-sms.channel';
import { MailpitEmailChannel } from '@notification/infrastructure/channels/mailpit-email.channel';

/** Binds the three channel adapters + assembles the channel-name -> adapter map the worker resolves against. */
@Module({
  providers: [
    { provide: EMAIL_CHANNEL, useClass: MailpitEmailChannel },
    { provide: SMS_CHANNEL, useClass: LogSmsChannel },
    { provide: PUSH_CHANNEL, useClass: LogPushChannel },
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (
        email: NotificationChannel,
        sms: NotificationChannel,
        push: NotificationChannel,
      ): NotificationChannelMap => ({ email, sms, push }),
      inject: [EMAIL_CHANNEL, SMS_CHANNEL, PUSH_CHANNEL],
    },
  ],
  exports: [NOTIFICATION_CHANNELS],
})
export class NotificationChannelsModule {}
