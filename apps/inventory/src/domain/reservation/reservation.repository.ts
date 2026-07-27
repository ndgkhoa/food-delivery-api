import type { Reservation } from '@inventory/domain/reservation/reservation';

export interface ReservationRepository {
  save(reservation: Reservation): Promise<Reservation>;
  /** Active (non-released) holds for an order — drives reserve idempotency and release. */
  findActiveByOrder(tenantId: string, orderId: string): Promise<Reservation[]>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');
