import { io, type Socket } from 'socket.io-client';
import { DELIVERY_BASE_URL } from './delivery-e2e-config';

/** Opens a Socket.IO connection presenting `token` on the handshake auth field. */
export function connectClient(token: string): Socket {
  return io(DELIVERY_BASE_URL, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

/** Resolves once the socket connects, rejecting on a bounded timeout. */
export function waitForConnect(socket: Socket, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for connect')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolves with the first payload of `event`, rejecting if none arrives before the timeout. */
export function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
