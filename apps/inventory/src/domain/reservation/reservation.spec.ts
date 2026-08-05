import { Reservation } from '@inventory/domain/reservation/reservation';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';

describe('Reservation', () => {
  it('creates an active reservation with matching timestamps', () => {
    const reservation = Reservation.create({ id, tenantId, orderId, itemId, qty: 3 });

    expect(reservation.id).toBe(id);
    expect(reservation.tenantId).toBe(tenantId);
    expect(reservation.orderId).toBe(orderId);
    expect(reservation.itemId).toBe(itemId);
    expect(reservation.qty).toBe(3);
    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.createdAt).toBeInstanceOf(Date);
    expect(reservation.updatedAt).toEqual(reservation.createdAt);
  });

  it.each([0, -1, 1.5])('rejects a non-positive-integer qty (%s)', (qty) => {
    expect(() => Reservation.create({ id, tenantId, orderId, itemId, qty })).toThrow(
      'Reservation qty must be a positive integer',
    );
  });

  it('rehydrates already-validated persistence data', () => {
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    const updatedAt = new Date('2020-01-02T00:00:00.000Z');
    const reservation = Reservation.reconstitute({
      id,
      tenantId,
      orderId,
      itemId,
      qty: 5,
      status: 'RELEASED',
      createdAt,
      updatedAt,
    });

    expect(reservation.status).toBe('RELEASED');
    expect(reservation.qty).toBe(5);
    expect(reservation.createdAt).toBe(createdAt);
    expect(reservation.updatedAt).toBe(updatedAt);
  });
});
