import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';
import { selectNearestAvailableDriver } from '@delivery/domain/delivery/select-nearest-driver';

describe('selectNearestAvailableDriver', () => {
  const candidates: NearbyDriver[] = [
    { driverId: 'far', distanceMeters: 900 },
    { driverId: 'near', distanceMeters: 100 },
    { driverId: 'mid', distanceMeters: 400 },
  ];

  it('returns the closest candidate when none are busy', () => {
    expect(selectNearestAvailableDriver(candidates, new Set())).toEqual({
      driverId: 'near',
      distanceMeters: 100,
    });
  });

  it('skips busy drivers and returns the next-nearest free one', () => {
    expect(selectNearestAvailableDriver(candidates, new Set(['near']))).toEqual({
      driverId: 'mid',
      distanceMeters: 400,
    });
  });

  it('returns undefined when every candidate is busy', () => {
    const busy = new Set(['near', 'mid', 'far']);
    expect(selectNearestAvailableDriver(candidates, busy)).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(selectNearestAvailableDriver([], new Set())).toBeUndefined();
  });

  it('does not depend on input ordering (re-sorts by distance)', () => {
    const unsorted: NearbyDriver[] = [
      { driverId: 'a', distanceMeters: 500 },
      { driverId: 'b', distanceMeters: 50 },
    ];
    expect(selectNearestAvailableDriver(unsorted, new Set())?.driverId).toBe('b');
  });
});
