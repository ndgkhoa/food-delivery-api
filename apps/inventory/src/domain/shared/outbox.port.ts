export interface OutboxCommandEntry {
  aggregateId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export interface OutboxWriter {
  append(entry: OutboxCommandEntry): Promise<void>;
}

export const OUTBOX_WRITER = Symbol('OutboxWriter');
