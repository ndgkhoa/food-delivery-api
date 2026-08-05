export interface TenantProps {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantProps {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
}

const MAX_NAME_LENGTH = 255;
const MAX_SLUG_LENGTH = 255;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertValidName(name: string): void {
  if (!name.trim()) {
    throw new Error('Tenant name is required');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Tenant name must be at most ${MAX_NAME_LENGTH} characters`);
  }
}

function assertValidSlug(slug: string): void {
  if (!slug) {
    throw new Error('Tenant slug is required');
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`Tenant slug must be at most ${MAX_SLUG_LENGTH} characters`);
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error('Tenant slug must be lowercase alphanumeric words separated by single hyphens');
  }
}

export class Tenant {
  private constructor(private readonly props: TenantProps) {}

  static create(props: CreateTenantProps): Tenant {
    const name = props.name.trim();
    const slug = props.slug.trim();
    assertValidName(name);
    assertValidSlug(slug);

    const now = new Date();
    return new Tenant({
      id: props.id,
      name,
      slug,
      isActive: props.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: TenantProps): Tenant {
    return new Tenant(props);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
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
}
