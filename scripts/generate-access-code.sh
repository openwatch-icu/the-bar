#!/usr/bin/env bash
# Generate a secure ACCESS_CODE for .env (min 16 chars; recommend 24+ bytes entropy).
# Usage: ./scripts/generate-access-code.sh   (paste output into .env as ACCESS_CODE=...)
set -e
code=$(openssl rand -base64 24 | tr -d '\n')
echo "ACCESS_CODE=$code"
