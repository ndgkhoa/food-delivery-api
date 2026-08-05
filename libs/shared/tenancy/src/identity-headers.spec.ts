import {
  applyTrustedIdentityHeaders,
  IDENTITY_SIG_HEADER,
  IDENTITY_TS_HEADER,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';

describe('applyTrustedIdentityHeaders (spoof resistance)', () => {
  const verified = {
    sub: 'user-123',
    tenantId: '11111111-1111-4111-8111-111111111111',
    roles: ['restaurant-owner'],
  };

  it('overwrites a spoofed tenant header with the verified token claim', () => {
    const headers: Record<string, string> = { [TENANT_ID_HEADER]: 'attacker-tenant' };

    applyTrustedIdentityHeaders(headers, verified);

    expect(headers[TENANT_ID_HEADER]).toBe(verified.tenantId);
    expect(headers[USER_ID_HEADER]).toBe(verified.sub);
    expect(headers[ROLES_HEADER]).toBe('restaurant-owner');
  });

  it('stamps a timestamp + signature when a signer is provided', () => {
    const headers: Record<string, string> = {};
    const signer = jest.fn(() => 'signed-value');

    applyTrustedIdentityHeaders(headers, verified, signer);

    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer).toHaveBeenCalledWith(verified, expect.any(Number));
    expect(headers[IDENTITY_TS_HEADER]).toMatch(/^\d+$/);
    expect(headers[IDENTITY_SIG_HEADER]).toBe('signed-value');
  });

  it('omits the timestamp + signature headers when no signer is provided', () => {
    const headers: Record<string, string> = {};

    applyTrustedIdentityHeaders(headers, verified);

    expect(headers[IDENTITY_TS_HEADER]).toBeUndefined();
    expect(headers[IDENTITY_SIG_HEADER]).toBeUndefined();
  });
});
