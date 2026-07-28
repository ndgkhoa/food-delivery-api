/** One driver returned by the nearby-drivers lookup. */
export interface NearbyDriverResponse {
  driverId: string;
  distanceMeters: number;
}

/** The current driver assignment for an order; `assigned` is false when none exists. */
export interface AssignmentResponse {
  orderId: string;
  assigned: boolean;
  driverId: string | null;
}
