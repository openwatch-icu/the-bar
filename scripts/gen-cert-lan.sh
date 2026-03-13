#!/usr/bin/env bash
# Generate a self-signed TLS cert valid for localhost and a LAN IP (for the-bar server).
# Usage: ./scripts/gen-cert-lan.sh [LAN_IP]
#   e.g. ./scripts/gen-cert-lan.sh <your_ip>
# Writes certs/cert.pem and certs/key.pem (create certs/ if missing).

set -e
LAN_IP="${1:-}"
if [ -z "$LAN_IP" ]; then
  echo "Usage: $0 LAN_IP   (e.g. $0 192.168.1.xxx)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERTS_DIR="$ROOT_DIR/certs"
mkdir -p "$CERTS_DIR"

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
cat > "$CONFIG" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = localhost
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = $LAN_IP
EOF

openssl req -x509 -newkey rsa:4096 -keyout "$CERTS_DIR/key.pem" -out "$CERTS_DIR/cert.pem" \
  -days 365 -nodes -config "$CONFIG" -extensions v3_req

echo "Wrote $CERTS_DIR/cert.pem and $CERTS_DIR/key.pem (valid for localhost and $LAN_IP)"
echo "Point TLS_CERT_FILE and TLS_KEY_FILE at these (e.g. ./certs/cert.pem, ./certs/key.pem)."
