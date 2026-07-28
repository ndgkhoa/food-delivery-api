/**
 * A driver discovered within a geo radius, with its distance from the search
 * origin in metres. Returned by the driver-location store's radius search and
 * fed to the pure nearest-available selection.
 */
export interface NearbyDriver {
  driverId: string;
  distanceMeters: number;
}
