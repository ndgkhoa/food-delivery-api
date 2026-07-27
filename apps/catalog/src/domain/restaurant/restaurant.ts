export interface RestaurantProps {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
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
