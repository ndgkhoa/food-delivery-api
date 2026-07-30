/** An inclusive `[from, to]` instant range every dashboard query is bounded by. */
export interface DateRange {
  from: Date;
  to: Date;
}

/** Raised by {@link parseDateRange} on an unparsable date or an inverted range — pure, no framework dependency. */
export class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateRangeError';
  }
}

/**
 * Parses and validates the `from`/`to` query params into a concrete
 * {@link DateRange}. The DTO layer already asserts ISO-8601 shape
 * (`@IsISO8601()`); this is the defense-in-depth parse plus the one check
 * class-validator can't express on its own — that the range isn't inverted.
 */
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
