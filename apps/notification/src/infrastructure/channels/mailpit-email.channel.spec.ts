import { MailpitEmailChannel } from '@notification/infrastructure/channels/mailpit-email.channel';
import { fakeConfig } from '@notification/testing/notification-test-doubles';
import { createTransport } from 'nodemailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('MailpitEmailChannel', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    sendMail.mockClear();
    (createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  it('opens the SMTP transport against the configured Mailpit host/port', () => {
    new MailpitEmailChannel(
      fakeConfig({
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        MAIL_FROM: 'noreply@food-delivery.test',
      }),
    );

    expect(createTransport).toHaveBeenCalledWith({ host: 'localhost', port: 1025, secure: false });
  });

  it('sends with the deterministic subject/body for the notification type, from MAIL_FROM', async () => {
    const channel = new MailpitEmailChannel(
      fakeConfig({
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        MAIL_FROM: 'noreply@food-delivery.test',
      }),
    );

    await channel.send({
      recipient: 'user-1@example.test',
      type: 'order-confirmed',
      data: { orderId: 'order-1' },
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@food-delivery.test',
      to: 'user-1@example.test',
      subject: 'Your order is confirmed',
      text: 'Order order-1 is confirmed. Thanks for ordering!',
    });
  });

  it('propagates a transport failure so BullMQ can retry the job', async () => {
    sendMail.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const channel = new MailpitEmailChannel(
      fakeConfig({
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        MAIL_FROM: 'noreply@food-delivery.test',
      }),
    );

    await expect(
      channel.send({ recipient: 'user-1@example.test', type: 'order-confirmed', data: {} }),
    ).rejects.toThrow('connect ECONNREFUSED');
  });
});
