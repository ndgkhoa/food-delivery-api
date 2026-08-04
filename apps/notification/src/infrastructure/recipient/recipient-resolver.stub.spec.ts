import { RecipientResolverStub } from '@notification/infrastructure/recipient/recipient-resolver.stub';

describe('RecipientResolverStub', () => {
  it('deterministically derives email/phone/pushToken from the userId', async () => {
    const resolver = new RecipientResolverStub();
    const userId = 'user-42';

    const first = await resolver.resolve(userId);
    const second = await resolver.resolve(userId);

    expect(first).toEqual(second);
    expect(first.email).toBe('user-42@example.test');
    expect(first.pushToken).toBe('push-token-user-42');
    expect(first.phone).toMatch(/^\+1555\d{7}$/);
  });

  it('derives different contact info for different users', async () => {
    const resolver = new RecipientResolverStub();

    const a = await resolver.resolve('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa');
    const b = await resolver.resolve('bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb');

    expect(a.email).not.toBe(b.email);
    expect(a.pushToken).not.toBe(b.pushToken);
  });
});
