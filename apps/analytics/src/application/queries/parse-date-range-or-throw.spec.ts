import { parseDateRangeOrThrow } from '@analytics/application/queries/parse-date-range-or-throw';
import {
  InvalidDateRangeError,
  parseDateRange,
} from '@analytics/domain/analytics-query/date-range';
import { BadRequestException } from '@nestjs/common';

jest.mock('@analytics/domain/analytics-query/date-range', () => {
  const actual = jest.requireActual('@analytics/domain/analytics-query/date-range');
  return { ...actual, parseDateRange: jest.fn(actual.parseDateRange) };
});

describe('parseDateRangeOrThrow', () => {
  afterEach(() => {
    jest
      .mocked(parseDateRange)
      .mockImplementation(
        jest.requireActual('@analytics/domain/analytics-query/date-range').parseDateRange,
      );
  });

  it('returns the parsed range for two valid ISO dates', () => {
    const range = parseDateRangeOrThrow('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z');

    expect(range.from).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(range.to).toEqual(new Date('2026-01-31T00:00:00Z'));
  });

  it('rethrows an invalid date range as a BadRequestException', () => {
    expect(() => parseDateRangeOrThrow('not-a-date', '2026-01-31T00:00:00Z')).toThrow(
      BadRequestException,
    );
  });

  it('rethrows any non-InvalidDateRangeError unchanged', () => {
    const unexpected = new Error('clock unavailable');
    jest.mocked(parseDateRange).mockImplementation(() => {
      throw unexpected;
    });

    expect(() => parseDateRangeOrThrow('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z')).toThrow(
      unexpected,
    );
  });

  it('type-guards on InvalidDateRangeError rather than error message shape', () => {
    expect(InvalidDateRangeError).toBeDefined();
  });
});
