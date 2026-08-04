export interface DateRange {
  from: Date;
  to: Date;
}

export class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateRangeError';
  }
}

export function parseDateRange(fromIso: string, toIso: string): DateRange {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime())) {
    throw new InvalidDateRangeError(`Invalid "from" date: "${fromIso}"`);
  }
  if (Number.isNaN(to.getTime())) {
    throw new InvalidDateRangeError(`Invalid "to" date: "${toIso}"`);
  }
  if (from.getTime() > to.getTime()) {
    throw new InvalidDateRangeError(`"from" (${fromIso}) must not be after "to" (${toIso})`);
  }
  return { from, to };
}
