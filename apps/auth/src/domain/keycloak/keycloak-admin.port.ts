export interface CreateKeycloakUserInput {
  tenantId: string;
  username: string;
  email: string;
  role: string;
  password: string;
}

export interface KeycloakAdminPort {
  createUser(input: CreateKeycloakUserInput): Promise<string>;
  deleteUser(userId: string): Promise<void>;
}

export const KEYCLOAK_ADMIN_PORT = Symbol('KeycloakAdminPort');
