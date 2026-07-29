import { Logger } from '@nestjs/common';
import { LogSmsChannel } from '@notification/infrastructure/channels/log-sms.channel';

describe('LogSmsChannel', () => {
  it('logs the send deterministically and never throws (a stub, not a real provider)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const channel = new LogSmsChannel();

    await expect(
      channel.send({ recipient: '+15551234567', type: 'order-confirmed', data: {} }),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith('[stub-sms] to=+15551234567 type=order-confirmed');
    logSpy.mockRestore();
  });
});
