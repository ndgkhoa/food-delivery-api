import {
  InvalidDateRangeError,
  parseDateRange,
} from '@analytics/domain/analytics-query/date-range';

describe('parseDateRange', () => {
  it('parses two ISO instants into a DateRange', () => {
    const range = parseDateRange('2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.999Z');
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('accepts a date-only ISO string', () => {
    const range = parseDateRange('2026-01-01', '2026-01-02');
    expect(range.from.getTime()).toBeLessThan(range.to.getTime());
  });

  it('accepts an equal from/to (a single-instant range)', () => {
    const range = parseDateRange('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    expect(range.from.getTime()).toBe(range.to.getTime());
  });

  it('rejects an unparsable "from"', () => {
    expect(() => parseDateRange('not-a-date', '2026-01-01')).toThrow(InvalidDateRangeError);
  });

  it('rejects an unparsable "to"', () => {
    expect(() => parseDateRange('2026-01-01', 'not-a-date')).toThrow(InvalidDateRangeError);
  });

  it('rejects an inverted range (from after to)', () => {
    expect(() => parseDateRange('2026-01-31', '2026-01-01')).toThrow(InvalidDateRangeError);
  });
});
