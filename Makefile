# StackSense developer shortcuts. Run `make help`.
SHELL := /bin/bash
PY := backend/.venv/bin

.PHONY: help setup api worker web admin dev test test-pg lint e2e migrate migration seed up down

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

setup: ## Install backend (venv) and frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -e '.[dev,llm]'
	cd web && npm install
	cd admin && npm install

api: ## Run the API on :8000 (SQLite, auto-seeded in dev)
	cd backend && .venv/bin/uvicorn stacksense.main:app --reload --port 8000

worker: ## Run background jobs (outbox, reminders, consent enforcement, retention…)
	cd backend && .venv/bin/stacksense-worker

web: ## Run the web PWA on :3000
	cd web && npm run dev

admin: ## Run the admin console on :3001
	cd admin && npm run dev

test: ## Backend tests (SQLite) + web and admin unit tests
	cd backend && .venv/bin/pytest -q
	cd web && npm test
	cd admin && npm test

test-pg: ## API-level backend tests on Postgres (set STACKSENSE_TEST_DATABASE_URL)
	cd backend && .venv/bin/pytest -q tests/test_api_contract.py tests/test_entitlements_billing.py tests/test_privacy_admin.py

lint: ## Ruff + TypeScript
	cd backend && .venv/bin/ruff check stacksense tests migrations
	cd web && npm run typecheck
	cd admin && npm run typecheck

e2e: ## Playwright against running API (:8000), web (:3000) and admin (:3001)
	cd web && npx playwright test

migrate: ## Apply migrations to STACKSENSE_DATABASE_URL
	cd backend && .venv/bin/alembic upgrade head

migration: ## New migration from model changes: make migration m="add x"
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

seed: ## Load reference data and dev staff into STACKSENSE_DATABASE_URL
	cd backend && .venv/bin/stacksense-seed --dev

up: ## Full stack in Docker (Postgres, Redis, API, worker, web, admin)
	docker compose up --build

down: ## Stop the Docker stack
	docker compose down
