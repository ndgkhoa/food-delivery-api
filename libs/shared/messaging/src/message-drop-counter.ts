import { Injectable } from '@nestjs/common';

export type DropReason = 'undecodable' | 'handler-exhausted';

@Injectable()
export class MessageDropCounter {
  private readonly counts = new Map<string, number>();

  private static key(topic: string, reason: DropReason): string {
    return `${topic}::${reason}`;
  }

  record(topic: string, reason: DropReason): void {
    const key = MessageDropCounter.key(topic, reason);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  get(topic: string, reason: DropReason): number {
    return this.counts.get(MessageDropCounter.key(topic, reason)) ?? 0;
  }

  total(): number {
    let total = 0;
    for (const value of this.counts.values()) {
      total += value;
    }
    return total;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
