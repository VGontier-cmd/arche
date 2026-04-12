# Arche — one-shot and split-process dev helpers
# Requires Node 22+, npm, and a configured workspace (`arche init` or `.arche/environment`).

.DEFAULT_GOAL := help

# Built CLI (after `make build`). Override if `arche` is on PATH: `make dev-dist ARCHE_CLI=arche`
ARCHE_CLI ?= node dist/cli.js

.PHONY: help install build check test dev dev-server dev-worker \
	ensure-dist serve-dist worker-dist run dev-dist up install-prereqs

help:
	@echo "Arche Makefile"
	@echo ""
	@echo "  make install-prereqs  git / Node 22+ / Docker (see scripts/install-host-prereqs.sh)"
	@echo "  make install         npm install"
	@echo "  make build           Production bundle (tsup → dist/)"
	@echo "  make check           eslint + tsc --noEmit"
	@echo "  make test            vitest"
	@echo ""
	@echo "Dev (tsx):"
	@echo "  make dev             API + worker (Ctrl+C to stop)"
	@echo "  make dev-server      npm run server"
	@echo "  make dev-worker      npm run worker"
	@echo "  make up              arche up (server + worker + open dashboard)"
	@echo ""
	@echo "Prod / packaged (needs dist/cli.js — \`make build\` once):"
	@echo "  make run             serve + worker (Ctrl+C to stop) — alias: make dev-dist"
	@echo "  make serve-dist      \`serve\` only"
	@echo "  make worker-dist     \`worker\` only"
	@echo "  Tip: after \`npm install -g .\` use   make run ARCHE_CLI=arche"

install-prereqs:
	bash scripts/install-host-prereqs.sh

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

up:
	npm run cli -- up

# Run machine API and worker loop from one shell.
dev:
	@bash -c 'set -e; \
		echo "Starting Arche server + worker (Ctrl+C to stop)..."; \
		npm run server & server_pid=$$!; \
		npm run worker & worker_pid=$$!; \
		trap "kill $$server_pid $$worker_pid 2>/dev/null || true" EXIT INT TERM; \
		wait'

ensure-dist:
	@test -f dist/cli.js || (echo "Missing dist/cli.js — run: make build" >&2 && exit 1)

serve-dist: ensure-dist
	$(ARCHE_CLI) serve

worker-dist: ensure-dist
	$(ARCHE_CLI) worker

# Same orchestration as `make dev`, using the built CLI.
run dev-dist: ensure-dist
	@bash -c 'set -e; \
		echo "Starting Arche (dist) serve + worker (Ctrl+C to stop)..."; \
		$(ARCHE_CLI) serve & server_pid=$$!; \
		$(ARCHE_CLI) worker & worker_pid=$$!; \
		trap "kill $$server_pid $$worker_pid 2>/dev/null || true" EXIT INT TERM; \
		wait'
