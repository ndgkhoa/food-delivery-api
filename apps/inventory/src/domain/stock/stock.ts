import { InsufficientStockError } from '@inventory/domain/shared/errors';

export interface StockProps {
  tenantId: string;
  itemId: string;
  /** Units currently available to reserve. The invariant: never negative. */
  available: number;
}

function assertNonNegativeInteger(available: number): void {
  if (!Number.isInteger(available) || available < 0) {
    throw new Error('Stock available must be a non-negative integer');
  }
}

/**
 * Stock aggregate — the guardian of the no-oversell invariant. Keyed naturally
 * by (tenantId, itemId). Plain class, no ORM/framework deps. Immutable updates:
 * `reserve`/`release` return a new instance so callers persist the result.
 */
export class Stock {
  private constructor(private readonly props: StockProps) {}

  static create(props: StockProps): Stock {
    assertNonNegativeInteger(props.available);
    return new Stock({ ...props });
  }

  /** Rehydrate from persistence — data is already validated. */
  static reconstitute(props: StockProps): Stock {
    return new Stock({ ...props });
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get itemId(): string {
    return this.props.itemId;
  }

  get available(): number {
    return this.props.available;
  }

  /**
   * Decrements available by `qty`. Throws `InsufficientStockError` rather than
   * ever letting available fall below zero — the invariant enforced in code
   * (with a DB CHECK constraint as a second line of defense).
   */
  reserve(qty: number): Stock {
    assertPositiveQty(qty);
    if (qty > this.props.available) {
      throw new InsufficientStockError(this.props.itemId, qty, this.props.available);
    }
    return new Stock({ ...this.props, available: this.props.available - qty });
  }

  /** Returns `qty` units to available (on order cancel / reservation release). */
  release(qty: number): Stock {
    assertPositiveQty(qty);
    return new Stock({ ...this.props, available: this.props.available + qty });
  }
}

function assertPositiveQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive integer');
  }
}
