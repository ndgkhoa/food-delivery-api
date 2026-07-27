import type { Reservation } from '@inventory/domain/reservation/reservation';

export interface ReservationRepository {
  save(reservation: Reservation): Promise<Reservation>;
  /** Active (non-released) holds for an order — drives reserve idempotency and release. */
  findActiveByOrder(tenantId: string, orderId: string): Promise<Reservation[]>;
  /**
   * Atomically flip a hold ACTIVE→RELEASED in a single conditional UPDATE
   * (`... WHERE id = :id AND status = 'ACTIVE'`). Returns true only for the
   * caller that won the transition, so a concurrent double-release returns stock
   * exactly once (no phantom units). The releasing transaction pairs this with
   * increaseAvailable so both commit together.
   */
  releaseIfActive(reservation: Reservation): Promise<boolean>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');
