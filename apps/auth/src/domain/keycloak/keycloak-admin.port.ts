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
 * Framework-free port over the Keycloak Admin API. `createUser` is intentionally
 * coarse: it creates the user, sets the `tenant_id` attribute, AND assigns the
 * realm role, so the application layer never has to orchestrate individual
 * Keycloak REST calls or know the admin protocol. Returns the created user id.
 *
 * This is NOT distributed-atomic: Keycloak and the local registry are separate
 * systems with no shared transaction. The operation is create-then-compensate —
 * if a later step fails, the caller deletes the just-created Keycloak user via
 * `deleteUser` so the failure is all-or-nothing from the caller's view. A truly
 * transactional path (Saga/Outbox) is deferred backlog.
 */
export interface KeycloakAdminPort {
  createUser(input: CreateKeycloakUserInput): Promise<string>;
  /** Best-effort compensation: removes a user created by `createUser`. */
  deleteUser(userId: string): Promise<void>;
}

export const KEYCLOAK_ADMIN_PORT = Symbol('KeycloakAdminPort');
