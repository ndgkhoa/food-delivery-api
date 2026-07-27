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
  status: OrderStatus;
  items: OrderItem[];
  /** Integer cents — sum of every line item's `lineTotalCents`. */
  totalCents: number;
  /** Optimistic-lock version. 0 for a brand-new, not-yet-persisted aggregate. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderProps {
  id: string;
  tenantId: string;
  userId: string;
  items: OrderItem[];
}

/**
 * Order aggregate — a plain class with no ORM/framework dependency. Built via
 * `create()` (always starts `PENDING`) or `reconstitute()` (rehydrate from
 * persistence). State transitions (`reserve`/`confirm`/`cancel`) return a NEW
 * `Order` instance in the next state, or throw `IllegalOrderTransitionError`
 * when the transition is not in the allowed-transitions table — they never
 * mutate `this`.
 */
export class Order {
  private constructor(private readonly props: OrderProps) {}

  static create(props: CreateOrderProps): Order {
    if (props.items.length === 0) {
      throw new InvalidOrderRequestError('order must contain at least one item');
    }
    const totalCents = props.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (totalCents > MAX_MONEY_CENTS) {
      throw new InvalidOrderRequestError('order total exceeds the maximum allowed amount');
    }
    const now = new Date();
    return new Order({
      id: props.id,
      tenantId: props.tenantId,
      userId: props.userId,
      status: 'PENDING',
      items: props.items,
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

  get status(): OrderStatus {
    return this.props.status;
  }

  get items(): OrderItem[] {
    return this.props.items;
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
