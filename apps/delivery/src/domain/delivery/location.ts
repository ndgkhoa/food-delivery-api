export interface Location {
  lat: number;
  lng: number;
}

export class InvalidLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLocationError';
  }
}

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

export function createLocation(lat: unknown, lng: unknown): Location {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < LAT_MIN || lat > LAT_MAX) {
    throw new InvalidLocationError(`latitude must be a finite number in [${LAT_MIN}, ${LAT_MAX}]`);
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < LNG_MIN || lng > LNG_MAX) {
    throw new InvalidLocationError(`longitude must be a finite number in [${LNG_MIN}, ${LNG_MAX}]`);
  }
  return { lat, lng };
}
