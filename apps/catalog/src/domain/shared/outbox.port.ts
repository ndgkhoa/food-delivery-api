export interface OutboxEntry {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface OutboxWriter {
  write(entry: OutboxEntry): Promise<void>;
}

export const OUTBOX_PORT = Symbol('OutboxPort');
