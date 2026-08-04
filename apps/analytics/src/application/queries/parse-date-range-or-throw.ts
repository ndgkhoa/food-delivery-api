import type { DateRange } from '@analytics/domain/analytics-query/date-range';
import {
  InvalidDateRangeError,
  parseDateRange,
} from '@analytics/domain/analytics-query/date-range';
import { BadRequestException } from '@nestjs/common';

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
