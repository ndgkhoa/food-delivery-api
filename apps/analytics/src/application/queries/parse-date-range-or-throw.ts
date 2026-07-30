import type { DateRange } from '@analytics/domain/analytics-query/date-range';
import {
  InvalidDateRangeError,
  parseDateRange,
} from '@analytics/domain/analytics-query/date-range';
import { BadRequestException } from '@nestjs/common';

/**
 * Adapts the pure domain parser to the HTTP transport: an inverted or
 * unparsable range surfaces as 400, not an uncaught 500. Shared by every
 * dashboard query handler so the "from/to" contract stays identical across
 * revenue/top-restaurants/summary.
 */
export function parseDateRangeOrThrow(fromIso: string, toIso: string): DateRange {
  try {
    return parseDateRange(fromIso, toIso);
  } catch (error) {
    if (error instanceof InvalidDateRangeError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
