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
 * should use `FOR UPDATE SKIP LOCKED` so overlapping ticks/replicas claim
 * DIFFERENT batches instead of blocking. This is **at-least-once, not
 * exactly-once**: a row can still be published more than once if the relay
 * crashes after `publishBatch` but before `markPublished` — that gap is
 * inherent and consumers MUST dedupe by event id (see IdempotentConsumer).
 * Implement `runExclusively` to also serialize the whole drain (fetch through
 * markPublished) across replicas via an advisory lock, so running ≥2 relay
 * replicas for a service doesn't amplify steady-state duplicate publishes —
 * without it, the row lock releases at `fetchUnpublished`'s own tx commit,
 * well before publish, letting a second replica re-fetch and re-publish the
 * same still-unpublished rows.
 */
export interface OutboxPort {
  fetchUnpublished(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: string[]): Promise<void>;
  /**
   * Optionally bumps the `attempts` counter for rows whose publish just failed,
   * so a row that never publishes (poison producer/broker) is visible for a
   * reaper to escalate. Best-effort — a failure here is logged, not fatal.
   */
  incrementAttempts?(ids: string[]): Promise<void>;
  /**
   * Optionally wraps `drain` in a service-specific mutual-exclusion mechanism
   * (an advisory lock keyed per service) so only one replica's relay drains at
   * a time. `ran: false` means another replica already holds it — the relay
   * treats that as a clean, error-free skip and just tries again next tick.
   */
  runExclusively?<T>(drain: () => Promise<T>): Promise<{ ran: boolean; result?: T }>;
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

  /**
   * Drains a single batch. Exposed for tests and for callers that want to
   * trigger an off-cycle flush. When the port implements `runExclusively`,
   * the drain runs only if this replica wins the advisory lock; a lost race
   * is a clean skip (returns 0), not an error — the next tick tries again.
   */
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
      // Record the failed publish attempt on each row before backing off, so a
      // persistently-failing (poison) row surfaces via its climbing `attempts`.
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
    // Don't keep the event loop alive: a forgotten stop() must never hang
    // process shutdown or a test runner.
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
