import { IllegalSagaTransitionError } from '@order/domain/shared/errors';

export type SagaState = 'STARTED' | 'STOCK_RESERVED' | 'COMPLETED' | 'COMPENSATING' | 'CANCELLED';

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
  lastEventId: string | null;
  version: number;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartOrderSagaProps {
  orderId: string;
  tenantId: string;
  correlationId?: string | null;
}

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
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

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

  get attempts(): number {
    return this.props.attempts;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.props.state].length === 0;
  }

  canTransitionTo(next: SagaState): boolean {
    return ALLOWED_TRANSITIONS[this.props.state].includes(next);
  }

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
