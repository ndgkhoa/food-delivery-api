import { BadRequestException } from '@nestjs/common';

export const IF_MATCH_HEADER = 'if-match';

/** Bare decimal digits only — no sign, no whitespace, no scientific/hex notation. */
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Parses the optional `If-Match` conditional-update header into the aggregate
 * version the client last read. Kept as a bare positive integer (not a
 * quoted ETag) — this API has no other use for ETags, so a plain integer
 * keeps the client contract simple. Absent header -> `undefined`, so the
 * caller falls back to the save-time version guard only.
 *
 * Validated against a strict digits-only pattern rather than `Number()`
 * directly — `Number()` also accepts scientific notation ("1e3" -> 1000),
 * hex/octal/binary prefixes, and padded whitespace, all of which would
 * silently coerce a malformed header into a value that looks like a valid
 * positive integer.
 */
export function parseIfMatchVersion(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined || ifMatch.trim() === '') {
    return undefined;
  }
  if (!POSITIVE_INTEGER_PATTERN.test(ifMatch)) {
    throw new BadRequestException(`"${IF_MATCH_HEADER}" header must be a positive integer`);
  }
  const version = Number(ifMatch);
  if (version < 1) {
    throw new BadRequestException(`"${IF_MATCH_HEADER}" header must be a positive integer`);
  }
  return version;
}
