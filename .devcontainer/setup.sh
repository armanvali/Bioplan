#!/usr/bin/env bash
# One-time setup for a Codespace / dev container: install everything and build both web apps.
# The apps run in single-origin mode: the browser talks only to :3000 / :3001, which forward
# API calls to the API on 127.0.0.1:8000, so only those two ports need forwarding.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv backend/.venv
backend/.venv/bin/pip install --quiet --upgrade pip
backend/.venv/bin/pip install --quiet -e "backend[dev]"

for app in web admin; do
  (cd "$app" && npm ci --no-audit --no-fund && NEXT_PUBLIC_API_URL= API_PROXY_TARGET=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1 npm run build)
done
echo "StackSense: setup complete"
