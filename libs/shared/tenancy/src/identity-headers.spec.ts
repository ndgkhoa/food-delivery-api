import {
  applyTrustedIdentityHeaders,
  ROLES_HEADER,
  stripClientIdentityHeaders,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
} from './identity-headers';

describe('identity headers (spoof resistance)', () => {
  const verified = {
    sub: 'user-123',
    tenantId: '11111111-1111-4111-8111-111111111111',
    roles: ['restaurant-owner'],
  };

  it('strips any client-supplied identity headers', () => {
    const headers: Record<string, unknown> = {
      [TENANT_ID_HEADER]: 'attacker-tenant',
      [USER_ID_HEADER]: 'attacker',
      [ROLES_HEADER]: 'admin',
      'content-type': 'application/json',
    };

    stripClientIdentityHeaders(headers);

    expect(headers[TENANT_ID_HEADER]).toBeUndefined();
    expect(headers[USER_ID_HEADER]).toBeUndefined();
    expect(headers[ROLES_HEADER]).toBeUndefined();
    // Non-identity headers are left intact.
    expect(headers['content-type']).toBe('application/json');
  });

  it('overwrites a spoofed tenant header with the verified token claim', () => {
    // Simulate a client that tried to inject its own tenant id.
    const headers: Record<string, string> = { [TENANT_ID_HEADER]: 'attacker-tenant' };

    applyTrustedIdentityHeaders(headers, verified);

    // The verified claim wins — the spoofed value is ignored entirely.
    expect(headers[TENANT_ID_HEADER]).toBe(verified.tenantId);
    expect(headers[USER_ID_HEADER]).toBe(verified.sub);
    expect(headers[ROLES_HEADER]).toBe('restaurant-owner');
  });
});
