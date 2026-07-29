import { Logger } from '@nestjs/common';
import { LogPushChannel } from '@notification/infrastructure/channels/log-push.channel';

describe('LogPushChannel', () => {
  it('logs the send deterministically and never throws (a stub, not a real provider)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const channel = new LogPushChannel();

    await expect(
      channel.send({ recipient: 'push-token-user-1', type: 'order-cancelled', data: {} }),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith('[stub-push] to=push-token-user-1 type=order-cancelled');
    logSpy.mockRestore();
  });
});
