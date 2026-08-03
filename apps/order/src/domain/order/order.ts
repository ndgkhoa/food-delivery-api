import { MAX_MONEY_CENTS, type OrderItem } from '@order/domain/order/order-item';
import { IllegalOrderTransitionError, InvalidOrderRequestError } from '@order/domain/shared/errors';

export type OrderStatus = 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'CANCELLED';

/**
 * Explicit allowed-transitions table — the single source of truth for the
 * order state machine. Any transition not listed here is illegal and throws
 * `IllegalOrderTransitionError`. CONFIRMED and CANCELLED are terminal.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['RESERVED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: [],
};

export interface OrderProps {
  id: string;
  tenantId: string;
  /** Order owner — the verified token subject (`sub`) that placed it. */
  userId: string;
  /**
   * The single restaurant every line item belongs to (an order cannot span
   * multiple restaurants — enforced by `PlaceOrderHandler`, not here). Always
   * populated for an order placed after this field was introduced; a
   * straggler order placed before it reconstitutes with `''` (see
   * `OrderMapper.toDomain`) since it predates the invariant and is not
   * reviewable.
   */
  restaurantId: string;
  status: OrderStatus;
  items: OrderItem[];
  /** Integer cents — sum of every line item's `lineTotalCents`. */
  subtotalCents: number;
  /** Integer cents — the tenant's config-sourced delivery fee at placement time. */
  deliveryFeeCents: number;
  /** Integer cents — `floor(subtotalCents * vatRateBps / 10000)`. */
  vatCents: number;
  /** Integer cents — the tenant's config-sourced discount at placement time. */
  discountCents: number;
  /** Integer cents — `subtotalCents + deliveryFeeCents + vatCents - discountCents`, floored at 0. */
  totalCents: number;
  /** Optimistic-lock version. 0 for a brand-new, not-yet-persisted aggregate. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Config-sourced pricing tunables applied on top of the items subtotal. */
export interface OrderPricingInput {
  /** Integer cents, non-negative. */
  deliveryFeeCents: number;
  /** Basis points (1/100 of a percent), non-negative — e.g. 1000 = 10%. */
  vatRateBps: number;
  /** Integer cents, non-negative. */
  discountCents: number;
}

export interface CreateOrderProps {
  id: string;
  tenantId: string;
  userId: string;
  /** The single restaurant every item belongs to — required for every new order. */
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

/**
 * Order aggregate — a plain class with no ORM/framework dependency. Built via
 * `create()` (always starts `PENDING`) or `reconstitute()` (rehydrate from
 * persistence). State transitions (`reserve`/`confirm`/`cancel`) return a NEW
 * `Order` instance in the next state, or throw `IllegalOrderTransitionError`
 * when the transition is not in the allowed-transitions table — they never
 * mutate `this`.
 *
 * Pricing is a pure calculation over the constructor input, never IO: `create()`
 * sums line items into `subtotalCents`, applies the caller-supplied
 * `deliveryFeeCents`/`vatRateBps`/`discountCents` (sourced from config by the
 * caller, e.g. `PlaceOrderHandler`), and derives `vatCents` + the final
 * `totalCents`, floored at 0 so a discount can never push the charge negative.
 */
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
    // Every one of these is persisted in its own bounded (int4) money column, so
    // each must fit independently — guarding only the final total would let a
    // large fee/discount that nets to an in-range total still overflow its
    // column on insert (a raw DB error surfacing as a 500). Bound them all here
    // so an out-of-range config value fails as a clean domain error instead.
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

  /** Rehydrate from persistence — data is already validated and the version is authoritative. */
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

  /** PENDING → RESERVED, once inventory confirms the reserve succeeded. */
  reserve(): Order {
    return this.transitionTo('RESERVED');
  }

  /** RESERVED → CONFIRMED. */
  confirm(): Order {
    return this.transitionTo('CONFIRMED');
  }

  /** PENDING → CANCELLED or RESERVED → CANCELLED. */
  cancel(): Order {
    return this.transitionTo('CANCELLED');
  }
}
