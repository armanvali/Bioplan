#!/usr/bin/env bash
# Start the API (:8000, SQLite, auto-seeded demo data), the web app (:3000) and the admin
# console (:3001) in the background. Logs: /tmp/stacksense-*.log. Safe to run again.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

# In a Codespace, links the API generates (calendar feeds, checkout) point at the forwarded app URL.
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  WEB_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  WEB_URL="http://localhost:3000"
fi

pkill -f "uvicorn stacksense.main:app" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

(cd "$ROOT/backend" && STACKSENSE_ENV=dev STACKSENSE_DATABASE_URL="sqlite:///$ROOT/backend/demo.db" \
  STACKSENSE_PUBLIC_WEB_URL="$WEB_URL" STACKSENSE_PUBLIC_API_URL="$WEB_URL" \
  setsid nohup .venv/bin/uvicorn stacksense.main:app --host 127.0.0.1 --port 8000 > /tmp/stacksense-api.log 2>&1 < /dev/null &)
(cd "$ROOT/web" && NEXT_PUBLIC_API_URL= API_PROXY_TARGET=http://127.0.0.1:8000 setsid nohup npx next start --port 3000 > /tmp/stacksense-web.log 2>&1 < /dev/null &)
(cd "$ROOT/admin" && NEXT_PUBLIC_API_URL= API_PROXY_TARGET=http://127.0.0.1:8000 setsid nohup npx next start --port 3001 > /tmp/stacksense-admin.log 2>&1 < /dev/null &)

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:3000/v1/meta > /dev/null && curl -sf http://127.0.0.1:3001/login > /dev/null && break
  sleep 1
done
if curl -sf http://127.0.0.1:3000/v1/meta > /dev/null; then
  echo "StackSense is running: app on port 3000, admin console on port 3001 (see the Ports tab)."
else
  echo "StackSense didn't start; check /tmp/stacksense-*.log" >&2
fi
