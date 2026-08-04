import type { Reservation } from '@inventory/domain/reservation/reservation';

export interface ReservationRepository {
  save(reservation: Reservation): Promise<Reservation>;
  findActiveByOrder(tenantId: string, orderId: string): Promise<Reservation[]>;
  releaseIfActive(reservation: Reservation): Promise<boolean>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');
