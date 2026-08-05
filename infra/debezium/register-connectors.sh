#!/usr/bin/env bash
set -euo pipefail

CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECTOR_FILE="${SCRIPT_DIR}/catalog-outbox-connector.json"
CONNECTOR_NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${CONNECTOR_FILE}" | head -n1)"

echo "Waiting for Kafka Connect at ${CONNECT_URL} ..."
for _ in $(seq 1 30); do
  if curl -sf "${CONNECT_URL}/" >/dev/null; then
    break
  fi
  sleep 2
done

CONFIG_PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["config"]))' "${CONNECTOR_FILE}")"

echo "Registering connector '${CONNECTOR_NAME}' ..."
curl -sf -X PUT \
  -H 'Content-Type: application/json' \
  --data "${CONFIG_PAYLOAD}" \
  "${CONNECT_URL}/connectors/${CONNECTOR_NAME}/config" >/dev/null

echo "Connector status:"
curl -sf "${CONNECT_URL}/connectors/${CONNECTOR_NAME}/status"
echo
