# Arche — one-shot and split-process dev helpers
# Requires Node 22+, npm, and a configured workspace (`arche init` or `.arche/environment`).

.DEFAULT_GOAL := help

# Built CLI (after `make build`). Override if `arche` is on PATH: `make dev-dist ARCHE_CLI=arche`
ARCHE_CLI ?= node dist/cli.js

.PHONY: help install build check test dev dev-server dev-worker dev-dashboard \
	ensure-dist serve-dist worker-dist dashboard-dist run dev-dist

help:
	@echo "Arche Makefile"
	@echo ""
	@echo "  make install         npm install"
	@echo "  make build           Production bundle (tsup → dist/)"
	@echo "  make check           eslint + tsc --noEmit"
	@echo "  make test            vitest"
	@echo ""
	@echo "Dev (tsx):"
	@echo "  make dev             API + worker + dashboard — quit UI stops all"
	@echo "  make dev-server      npm run server"
	@echo "  make dev-worker      npm run worker"
	@echo "  make dev-dashboard   npm run cli -- dashboard"
	@echo ""
	@echo "Prod / packaged (needs dist/cli.js — \`make build\` once):"
	@echo "  make run             serve + worker + dashboard (quit UI stops all) — alias: make dev-dist"
	@echo "  make serve-dist      \`serve\` only"
	@echo "  make worker-dist     \`worker\` only"
	@echo "  make dashboard-dist  \`dashboard\` only"
	@echo "  Tip: after \`npm install -g .\` use   make run ARCHE_CLI=arche"

install:
	npm install

build:
	npm run build

check:
	npm run check

test:
	npm test

dev-server:
	npm run server

dev-worker:
	npm run worker

dev-dashboard:
	npm run cli -- dashboard

# Run machine API, worker loop, and operator dashboard from one shell.
# Uses tsx entrypoints (same as npm run server / worker / cli).
dev:
	@bash -c 'set -e; \
		echo "Starting Arche server + worker + dashboard (quit UI or Ctrl+C to stop)..."; \
		npm run server & server_pid=$$!; \
		npm run worker & worker_pid=$$!; \
		trap "kill $$server_pid $$worker_pid 2>/dev/null || true" EXIT INT TERM; \
		sleep 2; \
		npm run cli -- dashboard'

ensure-dist:
	@test -f dist/cli.js || (echo "Missing dist/cli.js — run: make build" >&2 && exit 1)

serve-dist: ensure-dist
	$(ARCHE_CLI) serve

worker-dist: ensure-dist
	$(ARCHE_CLI) worker

dashboard-dist: ensure-dist
	$(ARCHE_CLI) dashboard

# Same orchestration as \`make dev\`, using the built CLI (\`serve\` / \`worker\` / \`dashboard\`).
run dev-dist: ensure-dist
	@bash -c 'set -e; \
		echo "Starting Arche (dist) serve + worker + dashboard (quit UI or Ctrl+C to stop)..."; \
		$(ARCHE_CLI) serve & server_pid=$$!; \
		$(ARCHE_CLI) worker & worker_pid=$$!; \
		trap "kill $$server_pid $$worker_pid 2>/dev/null || true" EXIT INT TERM; \
		sleep 2; \
		$(ARCHE_CLI) dashboard'
