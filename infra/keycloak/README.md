# Keycloak realms

Two realm exports for the `food-delivery` realm — same roles, `tenant_id` +
`food-delivery-api` audience mappers, and PKCE SPA client, but with
environment-appropriate security.

| File | Used by | Posture |
|------|---------|---------|
| `realm-export.json` | dev `infra/docker-compose.yml` (`start-dev --import-realm`) and the auth-e2e / gateway-e2e testcontainers | **DEV / TEST ONLY.** `sslRequired: none`, seeded test users with plaintext passwords, direct-access grants (ROPC) so e2e can mint tokens by password, a 2s-token `food-delivery-shortlived` client for expiry tests, wildcard redirect/web origins. Convenient, deliberately insecure. |
| `realm-export.prod.json` | the managed / prod Keycloak | **PROD.** `sslRequired: external`, brute-force detection, password policy, no seeded users, no `shortlived` client, SPA client with `directAccessGrants: false` + explicit (non-wildcard) redirect/web origins, locked user profile. `fullScopeAllowed` is **kept `true`** on the SPA client — do NOT set it `false`: this is the first-party app client and RBAC needs the user's realm roles in the token (with `false`, `realm_access.roles` is dropped — verified). |

## Importing the prod realm

The prod Keycloak is external / managed (the k8s prod overlay points
`KEYCLOAK_URL` at `https://auth.example.com`), so this file is imported by
whoever provisions that Keycloak — e.g. `start --import-realm` on first boot, or
via the admin API / an IaC provider. It is **not** applied via kustomize.

## Replace-at-deploy (never committed here)

`realm-export.prod.json` carries only non-secret structure + placeholders. Before
importing, the deploying environment MUST supply from its secret manager:

- **Redirect / web origins** — replace `https://app.example.com` with the real
  front-end origin(s). Leaving a wildcard or a wrong origin is an open-redirect /
  token-leak risk.
- **Users** — none are seeded; real users arrive via registration or identity
  federation, provisioned per tenant (each needs a `tenant_id` attribute).
- **Client secrets** — the SPA client is public (PKCE, no secret); any
  confidential client added later gets its secret from the secret manager.
- **SMTP server** — the realm has `verifyEmail: true` and self-service
  `resetPasswordAllowed: true`, both of which need an SMTP server. Configure the
  realm's SMTP settings (host/port/credentials from the secret manager) at
  deploy; without it, email verification and password reset silently fail and
  non-federated users can be locked out. (Federated users pre-verified by the
  upstream IdP are unaffected.)

Do **not** import `realm-export.json` into a production Keycloak — it disables
SSL enforcement and ships known-password users.
