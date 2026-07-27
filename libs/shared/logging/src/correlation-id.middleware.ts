import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from './correlation-id.constants';

/**
 * Reads `x-correlation-id` from the incoming request (set by the gateway, or
 * by an upstream service), generating one if missing (e.g. direct/local calls),
 * then echoes it back on the response so callers can correlate logs/traces.
 *
 * Must run BEFORE pino-http's own middleware (mounted by `SharedLoggingModule`)
 * so `genReqId` can read the now-normalized header — wired via `app.use()` in
 * each service's `main.ts`, ahead of `app.useLogger()`.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[CORRELATION_ID_HEADER];
  const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

  req.headers[CORRELATION_ID_HEADER] = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}
