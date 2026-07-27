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
 * Stock read model — keyed naturally by (tenantId, itemId). A plain value object
 * with no ORM/framework deps, used to read current availability and surface a
 * friendly error before a reserve.
 *
 * Note: reserve/release do NOT mutate this object. A counter's no-oversell
 * invariant cannot be upheld by an in-memory read-modify-write (two callers read
 * the same value and both write it back → lost update / oversell). It is instead
 * enforced atomically in the DB: a single conditional `UPDATE ... WHERE available
 * >= qty` (see StockRepository.decrementIfAvailable) plus a CHECK (available >=
 * 0). The Redis lock only reduces contention; the DB is the real backstop.
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
}
