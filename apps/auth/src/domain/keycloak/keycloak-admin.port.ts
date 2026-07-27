export interface CreateKeycloakUserInput {
  /** Validated UUID stamped as the user's `tenant_id` attribute → future token claim. */
  tenantId: string;
  username: string;
  email: string;
  /** Realm role to assign (admin | restaurant-owner | customer | driver). */
  role: string;
  password: string;
}

/**
 * Framework-free port over the Keycloak Admin API. The single `createUser`
 * operation is intentionally coarse: it creates the user, sets the `tenant_id`
 * attribute, AND assigns the realm role as one atomic-from-the-caller unit, so
 * the application layer never has to orchestrate individual Keycloak REST calls
 * or know the admin protocol. Returns the created Keycloak user id.
 */
export interface KeycloakAdminPort {
  createUser(input: CreateKeycloakUserInput): Promise<string>;
}

export const KEYCLOAK_ADMIN_PORT = Symbol('KeycloakAdminPort');
