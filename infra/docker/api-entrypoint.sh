#!/bin/sh
# api:    run migrations, load reference data, serve the API
# worker: background jobs (outbox, reminders, consent enforcement, retention, ...)
set -e
case "${1:-api}" in
  api)
    alembic upgrade head
    if [ "${STACKSENSE_SEED_DEV_STAFF:-0}" = "1" ]; then stacksense-seed --dev; else stacksense-seed; fi
    exec uvicorn stacksense.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers "${WEB_CONCURRENCY:-2}"
    ;;
  worker)
    exec stacksense-worker
    ;;
  *)
    exec "$@"
    ;;
esac
