export interface UserTenantLinkProps {
  id: string;
  keycloakUserId: string;
  tenantId: string;
  role: string;
  createdAt: Date;
}

export interface CreateUserTenantLinkProps {
  id: string;
  keycloakUserId: string;
  tenantId: string;
  role: string;
}

/**
 * Records which Keycloak user belongs to which tenant (with the role they were
 * provisioned under). Keycloak owns the credential/identity; this link is the
 * platform-side registry answer to "which tenant is this user scoped to",
 * mirroring the `tenant_id` attribute stamped on the Keycloak user.
 */
export class UserTenantLink {
  private constructor(private readonly props: UserTenantLinkProps) {}

  static create(props: CreateUserTenantLinkProps): UserTenantLink {
    if (!props.keycloakUserId) {
      throw new Error('Keycloak user id is required');
    }
    if (!props.role) {
      throw new Error('Role is required');
    }
    return new UserTenantLink({ ...props, createdAt: new Date() });
  }

  static reconstitute(props: UserTenantLinkProps): UserTenantLink {
    return new UserTenantLink(props);
  }

  get id(): string {
    return this.props.id;
  }

  get keycloakUserId(): string {
    return this.props.keycloakUserId;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get role(): string {
    return this.props.role;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
