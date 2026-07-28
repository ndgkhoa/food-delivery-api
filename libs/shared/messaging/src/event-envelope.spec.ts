import {
  AGGREGATE_ID_HEADER,
  CORRELATION_ID_HEADER,
  decodeHeaders,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  type EventEnvelopeHeaders,
  encodeHeaders,
  MissingEventHeaderError,
  OCCURRED_AT_HEADER,
  TENANT_ID_HEADER,
} from './event-envelope';

describe('event envelope header codec', () => {
  const headers: EventEnvelopeHeaders = {
    eventId: 'evt-1',
    eventType: 'order.placed',
    aggregateId: 'order-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    occurredAt: '2026-07-28T00:00:00.000Z',
  };

  describe('encodeHeaders', () => {
    it('maps envelope fields to x-* string headers', () => {
      expect(encodeHeaders(headers)).toEqual({
        [EVENT_ID_HEADER]: 'evt-1',
        [EVENT_TYPE_HEADER]: 'order.placed',
        [AGGREGATE_ID_HEADER]: 'order-1',
        [TENANT_ID_HEADER]: 'tenant-1',
        [CORRELATION_ID_HEADER]: 'corr-1',
        [OCCURRED_AT_HEADER]: '2026-07-28T00:00:00.000Z',
      });
    });
  });

  describe('decodeHeaders', () => {
    it('round-trips encodeHeaders output back into the envelope fields', () => {
      const encoded = encodeHeaders(headers);
      expect(decodeHeaders(encoded)).toEqual(headers);
    });

    it('accepts Buffer header values as the confluent client returns them on consume', () => {
      const raw = Object.fromEntries(
        Object.entries(encodeHeaders(headers)).map(([key, value]) => [
          key,
          Buffer.from(value, 'utf8'),
        ]),
      );
      expect(decodeHeaders(raw)).toEqual(headers);
    });

    it('takes the first value when a header is repeated', () => {
      const raw = { ...encodeHeaders(headers), [EVENT_ID_HEADER]: ['evt-1', 'evt-1-dup'] };
      expect(decodeHeaders(raw).eventId).toBe('evt-1');
    });

    it('throws MissingEventHeaderError when a required header is absent', () => {
      const { [TENANT_ID_HEADER]: _omitted, ...incomplete } = encodeHeaders(headers);
      expect(() => decodeHeaders(incomplete)).toThrow(MissingEventHeaderError);
    });

    it('throws MissingEventHeaderError (fails closed) when headers are entirely undefined', () => {
      expect(() => decodeHeaders(undefined)).toThrow(MissingEventHeaderError);
    });

    it('treats an empty required header as missing (never runs in tenant scope "")', () => {
      const raw = { ...encodeHeaders(headers), [TENANT_ID_HEADER]: '' };
      expect(() => decodeHeaders(raw)).toThrow(MissingEventHeaderError);
    });
  });
});
