import { parseIfMatchVersion } from '@catalog/interface/http/if-match-header.util';
import { BadRequestException } from '@nestjs/common';

describe('parseIfMatchVersion', () => {
  it('returns undefined when the header is absent', () => {
    expect(parseIfMatchVersion(undefined)).toBeUndefined();
  });

  it('returns undefined when the header is blank', () => {
    expect(parseIfMatchVersion('  ')).toBeUndefined();
  });

  it('parses a positive integer header value', () => {
    expect(parseIfMatchVersion('3')).toBe(3);
  });

  it('rejects "0" with a 400', () => {
    expect(() => parseIfMatchVersion('0')).toThrow(BadRequestException);
  });

  it('rejects a negative value with a 400', () => {
    expect(() => parseIfMatchVersion('-1')).toThrow(BadRequestException);
  });

  it('rejects a non-integer value with a 400', () => {
    expect(() => parseIfMatchVersion('1.5')).toThrow(BadRequestException);
  });

  it('rejects a non-numeric value with a 400', () => {
    expect(() => parseIfMatchVersion('not-a-number')).toThrow(BadRequestException);
  });

  it('rejects scientific notation ("1e3") that `Number()` would otherwise coerce to 1000', () => {
    expect(() => parseIfMatchVersion('1e3')).toThrow(BadRequestException);
  });

  it('rejects hex notation ("0x1") that `Number()` would otherwise coerce to 1', () => {
    expect(() => parseIfMatchVersion('0x1')).toThrow(BadRequestException);
  });

  it('rejects a value with internal/padding whitespace ("1 2" or " 3")', () => {
    expect(() => parseIfMatchVersion('1 2')).toThrow(BadRequestException);
    expect(() => parseIfMatchVersion(' 3')).toThrow(BadRequestException);
    expect(() => parseIfMatchVersion('3 ')).toThrow(BadRequestException);
  });
});
