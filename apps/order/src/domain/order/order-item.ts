import { InvalidOrderRequestError } from '@order/domain/shared/errors';

export interface OrderItemProps {
  itemId: string;
  /** Positive integer — units of this item on the order. */
  qty: number;
  /** Integer cents, sourced from the catalog at order-placement time — never client-supplied. */
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

/**
 * A single line item on an order. `unitPriceCents` is always the catalog's
 * price at placement time (computed server-side, in `PlaceOrderHandler`) —
 * this value object never accepts a client-submitted price. Plain class, no
 * ORM/framework deps.
 */
export class OrderItem {
  private constructor(private readonly props: OrderItemProps) {}

  static create(props: CreateOrderItemProps): OrderItem {
    assertPositiveInteger(props.qty, 'quantity');
    assertNonNegativeInteger(props.unitPriceCents, 'unit price');
    return new OrderItem({ ...props, lineTotalCents: props.qty * props.unitPriceCents });
  }

  /** Rehydrate from persistence — data is already validated. */
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
