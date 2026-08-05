export type ReservationStatus = 'ACTIVE' | 'RELEASED';

export interface ReservationProps {
  id: string;
  tenantId: string;
  orderId: string;
  itemId: string;
  qty: number;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReservationProps {
  id: string;
  tenantId: string;
  orderId: string;
  itemId: string;
  qty: number;
}

export class Reservation {
  private constructor(private readonly props: ReservationProps) {}

  static create(props: CreateReservationProps): Reservation {
    if (!Number.isInteger(props.qty) || props.qty <= 0) {
      throw new Error('Reservation qty must be a positive integer');
    }
    const now = new Date();
    return new Reservation({ ...props, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }

  static reconstitute(props: ReservationProps): Reservation {
    return new Reservation({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get itemId(): string {
    return this.props.itemId;
  }

  get qty(): number {
    return this.props.qty;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
