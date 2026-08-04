export interface MenuItemProps {
  id: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version?: number;
}

export interface CreateMenuItemProps {
  id: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  description?: string | null;
  priceCents: number;
  isAvailable?: boolean;
}

export interface UpdateMenuItemProps {
  name?: string;
  description?: string | null;
  priceCents?: number;
  isAvailable?: boolean;
}

const MAX_NAME_LENGTH = 255;

function assertValidName(name: string): void {
  if (!name.trim()) {
    throw new Error('Menu item name is required');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Menu item name must be at most ${MAX_NAME_LENGTH} characters`);
  }
}

function assertValidPriceCents(priceCents: number): void {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error('Menu item priceCents must be a non-negative integer');
  }
}

export class MenuItem {
  private constructor(private readonly props: MenuItemProps) {}

  static create(props: CreateMenuItemProps): MenuItem {
    const name = props.name.trim();
    assertValidName(name);
    assertValidPriceCents(props.priceCents);

    const now = new Date();
    return new MenuItem({
      id: props.id,
      tenantId: props.tenantId,
      restaurantId: props.restaurantId,
      name,
      description: props.description ?? null,
      priceCents: props.priceCents,
      isAvailable: props.isAvailable ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  static reconstitute(props: MenuItemProps): MenuItem {
    return new MenuItem(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get priceCents(): number {
    return this.props.priceCents;
  }

  get isAvailable(): boolean {
    return this.props.isAvailable;
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

  get version(): number {
    return this.props.version ?? 1;
  }

  update(changes: UpdateMenuItemProps): MenuItem {
    const name = changes.name !== undefined ? changes.name.trim() : this.props.name;
    assertValidName(name);

    const priceCents =
      changes.priceCents !== undefined ? changes.priceCents : this.props.priceCents;
    assertValidPriceCents(priceCents);

    return new MenuItem({
      ...this.props,
      name,
      description: changes.description !== undefined ? changes.description : this.props.description,
      priceCents,
      isAvailable: changes.isAvailable !== undefined ? changes.isAvailable : this.props.isAvailable,
      updatedAt: new Date(),
    });
  }

  toSnapshot(): Record<string, unknown> {
    return { ...this.props };
  }
}
