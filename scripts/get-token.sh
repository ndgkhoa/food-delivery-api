#!/bin/bash
# Fetches a Keycloak access token for a seeded dev user via the direct-grant
# (password) flow, so you can paste it into Scalar's "Authorize" or a curl call.
# Usage: pnpm token [owner|customer|admin]   (default: customer)
#
# These are the DEV realm's seeded test users (see infra/keycloak/realm-export.json)
# — safe to hard-code here; never reuse this flow or these creds outside local dev.
set -euo pipefail

ROLE="${1:-customer}"
case "$ROLE" in
  owner)    KC_USER=owner-user;    KC_PASS=owner-pass ;;
  customer) KC_USER=customer-user; KC_PASS=customer-pass ;;
  admin)    KC_USER=admin-user;    KC_PASS=admin-pass ;;
  *) echo "unknown role '$ROLE' — use one of: owner | customer | admin" >&2; exit 1 ;;
esac

KC_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${KEYCLOAK_REALM:-food-delivery}"
CLIENT="${KEYCLOAK_SPA_CLIENT_ID:-food-delivery-spa}"

curl -s -X POST "$KC_URL/realms/$REALM/protocol/openid-connect/token" \
  -d grant_type=password -d "client_id=$CLIENT" \
  -d "username=$KC_USER" -d "password=$KC_PASS" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('access_token'); print(t) if t else (sys.exit('token error: '+json.dumps(d)))"
