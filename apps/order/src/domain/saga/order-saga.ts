import { IllegalSagaTransitionError } from '@order/domain/shared/errors';

/**
 * States the order saga moves through. Happy path: STARTED → STOCK_RESERVED →
 * COMPLETED. Failure paths: STARTED → CANCELLED (stock reserve failed) and
 * STOCK_RESERVED → COMPENSATING → CANCELLED (payment failed, stock released).
 */
export type SagaState = 'STARTED' | 'STOCK_RESERVED' | 'COMPLETED' | 'COMPENSATING' | 'CANCELLED';

/**
 * Explicit allowed-transitions table — the single source of truth for the saga
 * state machine. COMPLETED and CANCELLED are terminal. Any transition not
 * listed here is illegal and throws `IllegalSagaTransitionError`.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SagaState, readonly SagaState[]>> = {
  STARTED: ['STOCK_RESERVED', 'CANCELLED'],
  STOCK_RESERVED: ['COMPLETED', 'COMPENSATING'],
  COMPENSATING: ['CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export interface OrderSagaProps {
  orderId: string;
  tenantId: string;
  state: SagaState;
  correlationId: string | null;
  /** Event id of the last reply applied — supports the idempotency ledger. */
  lastEventId: string | null;
  /** Optimistic-lock version. 0 for a brand-new, not-yet-persisted saga. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartOrderSagaProps {
  orderId: string;
  tenantId: string;
  correlationId?: string | null;
}

/**
 * Order saga aggregate — a plain class with no ORM/framework dependency.
 * `transition()` returns a NEW `OrderSaga` in the next state (recording the
 * driving event id) or throws when the transition is not allowed; it never
 * mutates `this`. Persistence enforces the optimistic lock on `version`.
 */
export class OrderSaga {
  private constructor(private readonly props: OrderSagaProps) {}

  static start(props: StartOrderSagaProps): OrderSaga {
    const now = new Date();
    return new OrderSaga({
      orderId: props.orderId,
      tenantId: props.tenantId,
      state: 'STARTED',
      correlationId: props.correlationId ?? null,
      lastEventId: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Rehydrate from persistence — the version is authoritative. */
  static reconstitute(props: OrderSagaProps): OrderSaga {
    return new OrderSaga({ ...props });
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get state(): SagaState {
    return this.props.state;
  }

  get correlationId(): string | null {
    return this.props.correlationId;
  }

  get lastEventId(): string | null {
    return this.props.lastEventId;
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

  /** True when the saga can no longer transition (COMPLETED or CANCELLED). */
  get isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.props.state].length === 0;
  }

  /** True when `next` is a legal transition from the current state. */
  canTransitionTo(next: SagaState): boolean {
    return ALLOWED_TRANSITIONS[this.props.state].includes(next);
  }

  /**
   * Returns a new saga in `next`, stamping `lastEventId` with the reply that
   * drove it. Throws `IllegalSagaTransitionError` for a disallowed transition.
   */
  transition(next: SagaState, drivingEventId: string): OrderSaga {
    if (!this.canTransitionTo(next)) {
      throw new IllegalSagaTransitionError(this.props.state, next);
    }
    return new OrderSaga({
      ...this.props,
      state: next,
      lastEventId: drivingEventId,
      updatedAt: new Date(),
    });
  }
}
