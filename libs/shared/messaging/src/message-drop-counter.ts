import { Injectable } from '@nestjs/common';

/**
 * Why a message was routed to a dead-letter topic instead of being processed:
 * - `undecodable`  — the envelope headers/payload could not be decoded; retrying
 *   can never fix it, so it is structurally unrecoverable.
 * - `handler-exhausted` — the handler kept throwing past its retry budget; the
 *   message is preserved for replay rather than silently skipped, so a stranded
 *   saga command/reply is observable and never lost.
 */
export type DropReason = 'undecodable' | 'handler-exhausted';

/**
 * In-process counter of messages dropped to a dead-letter topic, tagged by
 * source topic + reason. Deliberately tiny (a Map + getters): a Prometheus
 * registry is a later concern. A non-zero count is the operational signal that
 * a consumer is shedding saga traffic — pair it with the DLQ topic to replay.
 */
@Injectable()
export class MessageDropCounter {
  private readonly counts = new Map<string, number>();

  private static key(topic: string, reason: DropReason): string {
    return `${topic}::${reason}`;
  }

  /** Records one dropped message. */
  record(topic: string, reason: DropReason): void {
    const key = MessageDropCounter.key(topic, reason);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Count for one topic+reason (0 if none). */
  get(topic: string, reason: DropReason): number {
    return this.counts.get(MessageDropCounter.key(topic, reason)) ?? 0;
  }

  /** Total across all topics/reasons. */
  total(): number {
    let total = 0;
    for (const value of this.counts.values()) {
      total += value;
    }
    return total;
  }

  /** Flat snapshot (`"topic::reason" -> count`) for logging/inspection. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
