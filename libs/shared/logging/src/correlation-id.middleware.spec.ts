import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from './correlation-id.constants';
import { correlationIdMiddleware } from './correlation-id.middleware';

function buildMockReq(headers: Record<string, string | string[]> = {}): Request {
  return { headers } as unknown as Request;
}

function buildMockRes(): Response & { setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & { setHeader: jest.Mock };
}

describe('correlationIdMiddleware', () => {
  it('generates a new correlation id when the header is missing', () => {
    const req = buildMockReq();
    const res = buildMockRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    const generatedId = req.headers[CORRELATION_ID_HEADER] as string;
    expect(generatedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, generatedId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing correlation id from the incoming request', () => {
    const req = buildMockReq({ [CORRELATION_ID_HEADER]: 'upstream-id-123' });
    const res = buildMockRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.headers[CORRELATION_ID_HEADER]).toBe('upstream-id-123');
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'upstream-id-123');
  });

  it('picks the first value when the header is duplicated', () => {
    const req = buildMockReq({ [CORRELATION_ID_HEADER]: ['first-id', 'second-id'] });
    const res = buildMockRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.headers[CORRELATION_ID_HEADER]).toBe('first-id');
  });
});
