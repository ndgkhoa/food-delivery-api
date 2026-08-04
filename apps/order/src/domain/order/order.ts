import { MAX_MONEY_CENTS, type OrderItem } from '@order/domain/order/order-item';
import { IllegalOrderTransitionError, InvalidOrderRequestError } from '@order/domain/shared/errors';

export type OrderStatus = 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'CANCELLED';

const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['RESERVED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: [],
};

export interface OrderProps {
  id: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  deliveryFeeCents: number;
  vatCents: number;
  discountCents: number;
  totalCents: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderPricingInput {
  deliveryFeeCents: number;
  vatRateBps: number;
  discountCents: number;
}

export interface CreateOrderProps {
  id: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
  items: OrderItem[];
  pricing: OrderPricingInput;
}

function assertBoundedNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidOrderRequestError(`${label} must be a non-negative integer`);
  }
  if (value > MAX_MONEY_CENTS) {
    throw new InvalidOrderRequestError(`${label} exceeds the maximum allowed amount`);
  }
}

function assertValidPricingInput(pricing: OrderPricingInput): void {
  assertBoundedNonNegativeInteger(pricing.deliveryFeeCents, 'delivery fee');
  assertBoundedNonNegativeInteger(pricing.vatRateBps, 'VAT rate');
  assertBoundedNonNegativeInteger(pricing.discountCents, 'discount');
}

export class Order {
  private constructor(private readonly props: OrderProps) {}

  static create(props: CreateOrderProps): Order {
    if (props.items.length === 0) {
      throw new InvalidOrderRequestError('order must contain at least one item');
    }
    if (!props.restaurantId) {
      throw new InvalidOrderRequestError('restaurantId is required');
    }
    assertValidPricingInput(props.pricing);

    const subtotalCents = props.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const { deliveryFeeCents, vatRateBps, discountCents } = props.pricing;
    const vatCents = Math.floor((subtotalCents * vatRateBps) / 10000);
    const totalCents = Math.max(0, subtotalCents + deliveryFeeCents + vatCents - discountCents);
    for (const [amount, label] of [
      [subtotalCents, 'order subtotal'],
      [vatCents, 'order VAT'],
      [totalCents, 'order total'],
    ] as const) {
      if (amount > MAX_MONEY_CENTS) {
        throw new InvalidOrderRequestError(`${label} exceeds the maximum allowed amount`);
      }
    }

    const now = new Date();
    return new Order({
      id: props.id,
      tenantId: props.tenantId,
      userId: props.userId,
      restaurantId: props.restaurantId,
      status: 'PENDING',
      items: props.items,
      subtotalCents,
      deliveryFeeCents,
      vatCents,
      discountCents,
      totalCents,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: OrderProps): Order {
    return new Order({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get items(): OrderItem[] {
    return this.props.items;
  }

  get subtotalCents(): number {
    return this.props.subtotalCents;
  }

  get deliveryFeeCents(): number {
    return this.props.deliveryFeeCents;
  }

  get vatCents(): number {
    return this.props.vatCents;
  }

  get discountCents(): number {
    return this.props.discountCents;
  }

  get totalCents(): number {
    return this.props.totalCents;
  }

  get version(): number {
    return this.props.version;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isOwnedBy(userId: string): boolean {
    return this.props.userId === userId;
  }

  private transitionTo(next: OrderStatus): Order {
    if (!ALLOWED_TRANSITIONS[this.props.status].includes(next)) {
      throw new IllegalOrderTransitionError(this.props.status, next);
    }
    return new Order({ ...this.props, status: next, updatedAt: new Date() });
  }

  reserve(): Order {
    return this.transitionTo('RESERVED');
  }

  confirm(): Order {
    return this.transitionTo('CONFIRMED');
  }

  cancel(): Order {
    return this.transitionTo('CANCELLED');
  }
}
