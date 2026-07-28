import { extractHandshakeToken } from '@delivery/interface/ws/handshake-token';
import type { Socket } from 'socket.io';

/** Minimal handshake shape the extractor reads. */
function handshake(partial: {
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): Socket['handshake'] {
  return {
    auth: partial.auth ?? {},
    query: partial.query ?? {},
    headers: partial.headers ?? {},
  } as unknown as Socket['handshake'];
}

describe('extractHandshakeToken', () => {
  it('prefers the auth.token field', () => {
    expect(extractHandshakeToken(handshake({ auth: { token: 'a-tok' } }))).toBe('a-tok');
  });

  it('falls back to the token query param', () => {
    expect(extractHandshakeToken(handshake({ query: { token: 'q-tok' } }))).toBe('q-tok');
  });

  it('falls back to a Bearer Authorization header', () => {
    expect(extractHandshakeToken(handshake({ headers: { authorization: 'Bearer h-tok' } }))).toBe(
      'h-tok',
    );
  });

  it('returns undefined when no token is present', () => {
    expect(extractHandshakeToken(handshake({}))).toBeUndefined();
  });

  it('returns undefined for a malformed Authorization header', () => {
    expect(
      extractHandshakeToken(handshake({ headers: { authorization: 'Basic xyz' } })),
    ).toBeUndefined();
  });
});
