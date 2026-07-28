/**
 * Domain-level identity every published event carries, independent of the
 * payload. Kept transport-agnostic (plain strings) — Kafka-specific Buffer
 * encoding is the producer/consumer's job, not this codec's.
 */
export interface EventEnvelopeHeaders {
  eventId: string;
  eventType: string;
  aggregateId: string;
  tenantId: string;
  correlationId: string;
  /** ISO-8601 timestamp of when the event occurred (not when it was published). */
  occurredAt: string;
}

export interface EventEnvelope<TPayload = unknown> extends EventEnvelopeHeaders {
  payload: TPayload;
}

export const EVENT_ID_HEADER = 'x-event-id';
export const EVENT_TYPE_HEADER = 'x-event-type';
export const AGGREGATE_ID_HEADER = 'x-aggregate-id';
export const TENANT_ID_HEADER = 'x-tenant-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const OCCURRED_AT_HEADER = 'x-occurred-at';

/** Raised by {@link decodeHeaders} when a Kafka message is missing a required envelope header. */
export class MissingEventHeaderError extends Error {
  constructor(readonly headerName: string) {
    super(`Kafka message is missing required header "${headerName}"`);
    this.name = 'MissingEventHeaderError';
  }
}

/** Encodes envelope identity fields into `x-*` string headers ready for the producer to write to the wire. */
export function encodeHeaders(headers: EventEnvelopeHeaders): Record<string, string> {
  return {
    [EVENT_ID_HEADER]: headers.eventId,
    [EVENT_TYPE_HEADER]: headers.eventType,
    [AGGREGATE_ID_HEADER]: headers.aggregateId,
    [TENANT_ID_HEADER]: headers.tenantId,
    [CORRELATION_ID_HEADER]: headers.correlationId,
    [OCCURRED_AT_HEADER]: headers.occurredAt,
  };
}

/** The header-value shape the confluent Kafka client hands back on consume (single value, or one per repeated header). */
type RawKafkaHeaderValue = Buffer | string | (Buffer | string)[] | undefined;
export type RawKafkaHeaders = Record<string, RawKafkaHeaderValue>;

function headerToString(name: string, raw: RawKafkaHeaderValue): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new MissingEventHeaderError(name);
  }
  const str = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  // Treat an empty value as missing — an empty x-tenant-id would otherwise run
  // the handler in tenant scope "" (fail closed on identity/dedupe headers).
  if (str.length === 0) {
    throw new MissingEventHeaderError(name);
  }
  return str;
}

/** Decodes a consumed Kafka message's raw headers back into envelope identity fields. Fails closed: throws on any missing required header rather than silently defaulting. */
export function decodeHeaders(headers: RawKafkaHeaders | undefined): EventEnvelopeHeaders {
  const source = headers ?? {};
  return {
    eventId: headerToString(EVENT_ID_HEADER, source[EVENT_ID_HEADER]),
    eventType: headerToString(EVENT_TYPE_HEADER, source[EVENT_TYPE_HEADER]),
    aggregateId: headerToString(AGGREGATE_ID_HEADER, source[AGGREGATE_ID_HEADER]),
    tenantId: headerToString(TENANT_ID_HEADER, source[TENANT_ID_HEADER]),
    correlationId: headerToString(CORRELATION_ID_HEADER, source[CORRELATION_ID_HEADER]),
    occurredAt: headerToString(OCCURRED_AT_HEADER, source[OCCURRED_AT_HEADER]),
  };
}
