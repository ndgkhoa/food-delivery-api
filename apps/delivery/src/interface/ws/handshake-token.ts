import type { Socket } from 'socket.io';

/**
 * Extracts the bearer access token a WS client presents on the Socket.IO
 * handshake, checking (in order) `auth.token`, the `token` query param, and an
 * `Authorization: Bearer <token>` header. Pure + transport-shaped so it is
 * unit-testable without a live socket. Returns `undefined` when no token is
 * present — the caller rejects the connection.
 */
export function extractHandshakeToken(handshake: Socket['handshake']): string | undefined {
  const authToken = handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const queryToken = handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }

  const header = handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 ? token : undefined;
  }

  return undefined;
}
