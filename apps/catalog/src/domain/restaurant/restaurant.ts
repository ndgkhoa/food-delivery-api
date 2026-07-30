export interface RestaurantProps {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /**
   * Denormalized aggregate rating fed by the review service's recompute events.
   * Read-model only — the write model (this class doubles as both) never sets
   * these on `create`/`update`, so they stay `undefined` there and the getters
   * default to 0; `reconstitute` from a read row supplies the real values.
   */
  rating?: number;
  reviewCount?: number;
}

export interface CreateRestaurantProps {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateRestaurantProps {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

const MAX_NAME_LENGTH = 255;

function assertValidName(name: string): void {
  if (!name.trim()) {
    throw new Error('Restaurant name is required');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Restaurant name must be at most ${MAX_NAME_LENGTH} characters`);
  }
}

/**
 * Plain-class aggregate — no framework/ORM dependency. Constructed only via
 * `create()` (enforces invariants for brand-new restaurants) or
 * `reconstitute()` (rehydrates from persistence, already-validated data).
 */
export class Restaurant {
  private constructor(private readonly props: RestaurantProps) {}

  static create(props: CreateRestaurantProps): Restaurant {
    const name = props.name.trim();
    assertValidName(name);

    const now = new Date();
    return new Restaurant({
      id: props.id,
      tenantId: props.tenantId,
      name,
      description: props.description ?? null,
      isActive: props.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  static reconstitute(props: RestaurantProps): Restaurant {
    return new Restaurant(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  /** 0 on the write model (no reviews concept there); the real aggregate on a read-model reconstitution. */
  get rating(): number {
    return this.props.rating ?? 0;
  }

  get reviewCount(): number {
    return this.props.reviewCount ?? 0;
  }

  /** Returns a new `Restaurant` instance with the changes applied (immutable update). */
  update(changes: UpdateRestaurantProps): Restaurant {
    const name = changes.name !== undefined ? changes.name.trim() : this.props.name;
    assertValidName(name);

    return new Restaurant({
      ...this.props,
      name,
      description: changes.description !== undefined ? changes.description : this.props.description,
      isActive: changes.isActive !== undefined ? changes.isActive : this.props.isActive,
      updatedAt: new Date(),
    });
  }

  /** Plain-object snapshot for audit trail (jsonb before/after columns) — not used by persistence mappers. */
  toSnapshot(): Record<string, unknown> {
    return { ...this.props };
  }
}
