import { BadRequestException } from '@nestjs/common';

export const IF_MATCH_HEADER = 'if-match';

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

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
