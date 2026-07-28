import { Logger } from '@nestjs/common';
import type { MessageProducer, OutboundKafkaMessage } from './kafka-producer';

export interface OutboxRecord {
  id: string;
  topic: string;
  key: string;
  headers: Record<string, string>;
  value: unknown;
}

/**
 * Port a service's own outbox table adapter implements. `fetchUnpublished`
 * is expected to use `FOR UPDATE SKIP LOCKED` (or the store's equivalent) so
 * concurrent relay instances never double-claim a row.
 */
export interface OutboxPort {
  fetchUnpublished(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: string[]): Promise<void>;
}

export const OUTBOX_PORT = Symbol('OutboxPort');

export interface OutboxRelayOptions {
  /** Poll interval when the previous drain succeeded. @default 1000 */
  intervalMs?: number;
  /** Rows claimed per poll. @default 100 */
  batchSize?: number;
  /** Ceiling for the exponential backoff applied after a failed drain. @default 30000 */
  maxBackoffMs?: number;
}

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * Polling outbox publisher: drains a service's outbox table and publishes to
 * Kafka. Deliberately NOT auto-started — a consuming service constructs it
 * with its own `OutboxPort` adapter and calls `start()` (e.g. from
 * `OnApplicationBootstrap`), so this shared lib never assumes a service's
 * outbox schema or lifecycle.
 */
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

  /** Starts the polling loop. No-ops if already running. */
  start(): void {
    if (this.timer) {
      return;
    }
    this.scheduleNext(0);
  }

  /** Stops the polling loop. Safe to call repeatedly / when not running. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Drains a single batch. Exposed for tests and for callers that want to trigger an off-cycle flush. */
  async runOnce(): Promise<number> {
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
    await this.producer.publishBatch(messages);
    await this.outbox.markPublished(rows.map((row) => row.id));
    return rows.length;
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
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
