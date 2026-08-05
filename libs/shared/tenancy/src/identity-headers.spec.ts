import {
  applyTrustedIdentityHeaders,
  ROLES_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';

describe('identity headers (spoof resistance)', () => {
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
});
