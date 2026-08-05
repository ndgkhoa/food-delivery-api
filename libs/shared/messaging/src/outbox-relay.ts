import { Logger } from '@nestjs/common';
import type { MessageProducer, OutboundKafkaMessage } from './kafka-producer';

export interface OutboxRecord {
  id: string;
  topic: string;
  key: string;
  headers: Record<string, string>;
  value: unknown;
}

export interface OutboxPort {
  fetchUnpublished(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: string[]): Promise<void>;
  incrementAttempts?(ids: string[]): Promise<void>;
  runExclusively?<T>(drain: () => Promise<T>): Promise<{ ran: boolean; result?: T }>;
}

export const OUTBOX_PORT = Symbol('OutboxPort');

export interface OutboxRelayOptions {
  intervalMs?: number;
  batchSize?: number;
  maxBackoffMs?: number;
}

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBackoffMs: number;
  private timer: NodeJS.Timeout | null = null;
  private currentBackoffMs: number;

  constructor(
    private readonly outbox: OutboxPort,
    private readonly producer: MessageProducer,
    options: OutboxRelayOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.currentBackoffMs = this.intervalMs;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.scheduleNext(0);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<number> {
    if (!this.outbox.runExclusively) {
      return this.drainBatch();
    }
    const outcome = await this.outbox.runExclusively(() => this.drainBatch());
    return outcome.ran ? (outcome.result ?? 0) : 0;
  }

  private async drainBatch(): Promise<number> {
    const rows = await this.outbox.fetchUnpublished(this.batchSize);
    if (rows.length === 0) {
      return 0;
    }
    const messages: OutboundKafkaMessage[] = rows.map((row) => ({
      topic: row.topic,
      key: row.key,
      headers: row.headers,
      value: row.value,
    }));
    try {
      await this.producer.publishBatch(messages);
    } catch (error) {
      await this.recordFailedAttempts(rows.map((row) => row.id));
      throw error;
    }
    await this.outbox.markPublished(rows.map((row) => row.id));
    return rows.length;
  }

  private async recordFailedAttempts(ids: string[]): Promise<void> {
    if (!this.outbox.incrementAttempts) {
      return;
    }
    try {
      await this.outbox.incrementAttempts(ids);
    } catch (error) {
      this.logger.error(
        `Failed to record outbox publish attempts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
      this.currentBackoffMs = this.intervalMs;
      this.scheduleNext(this.intervalMs);
    } catch (error) {
      this.logger.error(
        `Outbox drain failed, backing off ${this.currentBackoffMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.scheduleNext(this.currentBackoffMs);
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    }
  }
}
