import { InvalidOrderRequestError } from '@order/domain/shared/errors';

export interface OrderItemProps {
  itemId: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface CreateOrderItemProps {
  itemId: string;
  qty: number;
  unitPriceCents: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidOrderRequestError(`${label} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidOrderRequestError(`${label} must be a non-negative integer`);
  }
}

export const MAX_MONEY_CENTS = 2_147_483_647;

export class OrderItem {
  private constructor(private readonly props: OrderItemProps) {}

  static create(props: CreateOrderItemProps): OrderItem {
    assertPositiveInteger(props.qty, 'quantity');
    assertNonNegativeInteger(props.unitPriceCents, 'unit price');
    const lineTotalCents = props.qty * props.unitPriceCents;
    if (lineTotalCents > MAX_MONEY_CENTS) {
      throw new InvalidOrderRequestError(
        `line total for item "${props.itemId}" exceeds the maximum allowed amount`,
      );
    }
    return new OrderItem({ ...props, lineTotalCents });
  }

  static reconstitute(props: OrderItemProps): OrderItem {
    return new OrderItem({ ...props });
  }

  get itemId(): string {
    return this.props.itemId;
  }

  get qty(): number {
    return this.props.qty;
  }

  get unitPriceCents(): number {
    return this.props.unitPriceCents;
  }

  get lineTotalCents(): number {
    return this.props.lineTotalCents;
  }
}
