import { createLocation, InvalidLocationError } from '@delivery/domain/delivery/location';

describe('createLocation', () => {
  it('accepts an in-bounds coordinate', () => {
    expect(createLocation(37.7749, -122.4194)).toEqual({ lat: 37.7749, lng: -122.4194 });
  });

  it('accepts the boundary values', () => {
    expect(createLocation(90, 180)).toEqual({ lat: 90, lng: 180 });
    expect(createLocation(-90, -180)).toEqual({ lat: -90, lng: -180 });
  });

  it.each([
    ['latitude too high', 90.1, 0],
    ['latitude too low', -90.1, 0],
    ['longitude too high', 0, 180.1],
    ['longitude too low', 0, -180.1],
  ])('rejects %s', (_label, lat, lng) => {
    expect(() => createLocation(lat, lng)).toThrow(InvalidLocationError);
  });

  it.each([
    ['NaN latitude', Number.NaN, 0],
    ['Infinity longitude', 0, Number.POSITIVE_INFINITY],
    ['string latitude', '10', 0],
    ['null longitude', 0, null],
  ])('rejects %s', (_label, lat, lng) => {
    expect(() => createLocation(lat, lng)).toThrow(InvalidLocationError);
  });
});
