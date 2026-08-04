export interface StockProps {
  tenantId: string;
  itemId: string;
  available: number;
}

function assertNonNegativeInteger(available: number): void {
  if (!Number.isInteger(available) || available < 0) {
    throw new Error('Stock available must be a non-negative integer');
  }
}

export class Stock {
  private constructor(private readonly props: StockProps) {}

  static create(props: StockProps): Stock {
    assertNonNegativeInteger(props.available);
    return new Stock({ ...props });
  }

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
