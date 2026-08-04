export interface NearbyDriverResponse {
  driverId: string;
  distanceMeters: number;
}

export interface AssignmentResponse {
  orderId: string;
  assigned: boolean;
  driverId: string | null;
}
