import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { describeError, normalizeHttpExceptionResponse, reasonPhrase } from './http-error-mapping';

describe('normalizeHttpExceptionResponse', () => {
  it('returns the plain string response as the message with no code', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    expect(normalizeHttpExceptionResponse(exception)).toEqual({ message: 'Not Found' });
  });

  it('extracts message and code from an object response body', () => {
    const exception = new BadRequestException({ message: 'Invalid payload', code: 'INVALID' });

    expect(normalizeHttpExceptionResponse(exception)).toEqual({
      message: 'Invalid payload',
      code: 'INVALID',
    });
  });

  it('falls back to the exception message and omits code when the body has no code field', () => {
    const exception = new HttpException({ statusCode: 400 }, HttpStatus.BAD_REQUEST);

    const result = normalizeHttpExceptionResponse(exception);

    expect(result.message).toBe(exception.message);
    expect(result.code).toBeUndefined();
  });

  it('ignores a non-string code field on the response body', () => {
    const exception = new HttpException({ message: 'oops', code: 42 }, HttpStatus.BAD_REQUEST);

    expect(normalizeHttpExceptionResponse(exception).code).toBeUndefined();
  });
});

describe('reasonPhrase', () => {
  it('title-cases the matching HttpStatus enum name', () => {
    expect(reasonPhrase(HttpStatus.NOT_FOUND)).toBe('Not Found');
    expect(reasonPhrase(HttpStatus.INTERNAL_SERVER_ERROR)).toBe('Internal Server Error');
  });

  it('falls back to "Internal Server Error" for an unmapped 5xx status', () => {
    expect(reasonPhrase(599)).toBe('Internal Server Error');
  });

  it('falls back to "Error" for an unmapped status below 500', () => {
    expect(reasonPhrase(499)).toBe('Error');
  });
});

describe('describeError', () => {
  it('returns the stack trace for a real Error instance', () => {
    const error = new Error('boom');

    expect(describeError(error)).toBe(error.stack);
  });

  it('falls back to the message when the Error has no stack', () => {
    const error = new Error('no stack here');
    error.stack = undefined;

    expect(describeError(error)).toBe('no stack here');
  });

  it('stringifies non-Error values', () => {
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError({ reason: 'weird' })).toBe(String({ reason: 'weird' }));
  });
});
