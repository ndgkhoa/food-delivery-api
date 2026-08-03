import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EntityNotFoundError as TypeOrmEntityNotFoundError } from 'typeorm';
import { DomainException } from './domain-exception';
import { GlobalExceptionFilter } from './global-exception.filter';

class OrderNotFoundError extends DomainException {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(orderId: string) {
    super(`Order "${orderId}" not found`);
  }
}

function buildHost(request: Partial<Request>): { host: ArgumentsHost; response: Response } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request as Request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

/** A non-HTTP (gRPC/Kafka/WS) host — `switchToHttp` would return junk, so the filter must skip it entirely. */
function buildRpcHost(): { host: ArgumentsHost; switchToHttp: jest.Mock } {
  const switchToHttp = jest.fn();
  const host = {
    getType: () => 'rpc',
    switchToHttp,
  } as unknown as ArgumentsHost;
  return { host, switchToHttp };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('maps a DomainException to its own httpStatus + code', () => {
    const { host, response } = buildHost({
      method: 'GET',
      url: '/api/v1/orders/42',
      headers: { [CORRELATION_ID_HEADER]: 'corr-1' },
    });

    filter.catch(new OrderNotFoundError('42'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        code: 'ORDER_NOT_FOUND',
        message: 'Order "42" not found',
        correlationId: 'corr-1',
        path: '/api/v1/orders/42',
      }),
    );
  });

  it('maps a plain-string HttpException to its status + message', () => {
    const { host, response } = buildHost({
      method: 'GET',
      url: '/api/v1/tenants/9',
      headers: {},
    });

    filter.catch(new ForbiddenException('not allowed'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        message: 'not allowed',
      }),
    );
  });

  it('normalizes a ValidationPipe-style HttpException (message: string[])', () => {
    const { host, response } = buildHost({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {},
    });

    filter.catch(
      new BadRequestException(['qty must be positive', 'items must not be empty']),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: ['qty must be positive', 'items must not be empty'],
      }),
    );
  });

  it('maps a raw TypeORM EntityNotFoundError to a generic 404', () => {
    const { host, response } = buildHost({ method: 'GET', url: '/api/v1/tenants/1', headers: {} });

    // biome-ignore lint/suspicious/noExplicitAny: TypeORM's constructor takes the entity class + criteria.
    filter.catch(new TypeOrmEntityNotFoundError('Tenant' as any, { id: '1' }), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(body.message).not.toMatch(/Tenant/);
  });

  it('maps an unknown error to a generic 500 and never leaks the internal message', () => {
    const { host, response } = buildHost({ method: 'GET', url: '/api/v1/anything', headers: {} });

    filter.catch(new Error('leaked db password: hunter2'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('always stamps timestamp and path even without a correlationId header', () => {
    const { host, response } = buildHost({ method: 'GET', url: '/api/v1/health', headers: {} });

    filter.catch(new Error('boom'), host);

    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.correlationId).toBeUndefined();
    expect(body.path).toBe('/api/v1/health');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('never throws even when writing the response itself fails', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation(() => {
        throw new Error('socket already closed');
      }),
    } as unknown as Response;
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/api/v1/x', headers: {} }) as Request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
  });

  it('skips a non-HTTP (gRPC/Kafka/WS) context entirely — no HTTP write, no log', () => {
    // Hybrid services inherit this filter into their RPC contexts; it must return
    // without touching switchToHttp() (which would mis-handle the RPC error and
    // spam the logs), letting Nest's RPC exception handler take over.
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    errorLog.mockClear();
    const { host, switchToHttp } = buildRpcHost();

    expect(() => filter.catch(new Error('grpc failure'), host)).not.toThrow();
    expect(switchToHttp).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});
