# Arche
## Self-hosted Development Agent Orchestrator

Arche is a **CLI-first TypeScript control plane** for running self-hosted development workflows from Jira tickets.

It includes:

- an `arche` CLI
- a Fastify server for webhooks and machine-facing APIs
- a separate Node worker for long-running jobs
- SQLite for local state, logs, and locks
- local Docker sandboxes for isolated runs

The recommended deployment model today is **VM/VPS host mode** with `CLI + server + worker`.
`docker-compose` is still available, but only as a secondary packaging or demo option.

## Prerequisites

At minimum you need:

- Node.js 22+
- npm
- `git`
- `docker`
- Jira access if you want to process real tickets
- GitLab access if you want to publish real merge requests
- an [OpenRouter](https://openrouter.ai) account and API key (`USER_OPENROUTER_API_KEY`); Arche uses the OpenRouter TypeScript SDK and calls the OpenRouter `chat/completions` API

## Installation

For end users, the recommended path is to install the `arche` binary into the `PATH`.

From the repository:

```bash
npm install
npm run build
npm install -g .
arche init
```

The `init` wizard:

- creates or updates `.arche/environment` (project install layout; shipped defaults live in `install/env.default` inside the package)
- creates or updates `orchestrator.yml` with the branch prefix and optional default repository fallback
- initializes SQLite automatically in `${ARCHE_RUNTIME_ROOT}/arche.db`
- creates runtime directories
- can configure `USER_OPENROUTER_API_KEY` for the default OpenRouter-backed executor profile

For a non-interactive bootstrap:

```bash
arche init --yes --force
```

For local development without a system-wide global install:

```bash
npm install
npm run build
npm link
arche init
```

Once the package is published, the intended install flow is:

```bash
npm install -g arche
arche init
```

## Important Files

- `.arche/environment`: runtime configuration and secrets for this workspace (written by `arche init`)
- `.env` (optional): still loaded first if present; use for ad hoc overrides or legacy setups
- `orchestrator.yml`: business rules and sandbox configuration
- `runtime/arche.db`: SQLite database
- `runtime/repos`: local Git mirrors
- `runtime/runs`: worktrees and run artifacts
- `runtime/logs`: runtime logs

## Configuration

### Environment (`.arche/environment`)

Example:

```env
DATABASE_URL=./runtime/arche.db
ARCHE_CONFIG_PATH=./orchestrator.yml
ARCHE_RUNTIME_ROOT=./runtime
ARCHE_SERVER_HOST=127.0.0.1
ARCHE_SERVER_AUTH_TOKEN=change-me
ARCHE_LOG_LEVEL=info
USER_OPENROUTER_API_KEY=change-me
USER_GIT_AUTHOR_NAME=arche-bot
USER_GIT_AUTHOR_EMAIL=arche-bot@example.invalid
USER_JIRA_BASE_URL=https://example.atlassian.net
USER_JIRA_EMAIL=agent-dev@example.com
USER_JIRA_API_TOKEN=change-me
USER_GITLAB_BASE_URL=https://gitlab.example.com
USER_GITLAB_TOKEN=change-me
```

Notes:

- `DATABASE_URL` normally does not need to be edited manually.
- `ARCHE_SERVER_HOST` defaults to `127.0.0.1`, so the machine API stays local-only unless you opt in to remote exposure.
- `ARCHE_SERVER_AUTH_TOKEN` protects the machine API via `Authorization: Bearer <token>` or `x-arche-api-token: <token>`.
- **`USER_GIT_AUTHOR_NAME`** and **`USER_GIT_AUTHOR_EMAIL`**: Git identity for automated commits (defaults suit a fresh install).
- `/health`, `/ready`, and `/webhooks/jira` stay reachable without the server auth token.
- if you bind Arche on a non-loopback host such as `0.0.0.0`, `ARCHE_SERVER_AUTH_TOKEN` is required and startup will fail without it.
- `ARCHE_LOG_LEVEL` only controls process log verbosity for `server`, `worker`, and `cli`. Keep `info` by default and switch to `debug` temporarily when troubleshooting.
- **`USER_*` variables** (OpenRouter key, Git identity, Jira, GitLab): values **you** supply. Arche reserves **`ARCHE_*`** and **`DATABASE_URL`** for its own runtime and paths.
- **`USER_OPENROUTER_API_KEY`**: OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys). The default `orchestrator.yml` profile sets `api_key_env` to this variable name.
- If you add extra executor profiles, point each profile’s `api_key_env` at the env var that holds that profile’s OpenRouter key (or reuse `USER_OPENROUTER_API_KEY` when one key is enough).
- **`USER_JIRA_API_TOKEN`** is created from your Atlassian account: `https://id.atlassian.com/manage-profile/security/api-tokens`
- Atlassian currently sets new API tokens to expire after one year by default, and the token value must be copied when it is created.
- `runs manual` uses Jira to fetch the ticket. Without Jira configured, that command will fail.
- `runs manual` enforces the same eligibility policy and active-run guard as the Jira webhook unless you pass an explicit force override.
- Model traffic goes through **OpenRouter**; set each profile `base_url` to `https://openrouter.ai/api/v1` (the shipped default).

### `orchestrator.yml`

The [orchestrator.yml](./orchestrator.yml) file controls:

- runtime directories
- Jira eligibility policy
- repository fallback routing
- git branch naming
- the Docker sandbox image
- allowed commands
- project validation commands
- optional bootstrap entries

Minimal example:

```yaml
runtime:
  root_dir: ./runtime
  repos_dir: ./runtime/repos
  runs_dir: ./runtime/runs
  logs_dir: ./runtime/logs
  db_retention_days: 30
  artifact_retention_days: 14
  failed_worktree_retention_days: 3

sandbox:
  image: node:22-bookworm
  network: bridge
  shell: /bin/bash
  read_only_rootfs: true
  tmpfs_paths:
    - /tmp
  cap_drop:
    - ALL
  no_new_privileges: true
  pids_limit: 256
  memory_limit_mb: 2048
  cpus: "2"
  env_allowlist: []
  user: ""

defaults:
  allowed_commands:
    - pwd
    - ls
    - find
    - cat
    - grep
    - git status
    - git diff
    - pnpm install
    - pnpm lint
    - pnpm test
    - pnpm typecheck
    - pnpm build
  validation_commands:
    - pnpm lint
    - pnpm test
    - pnpm typecheck

routing:
  default_repository: my-service

git:
  branch_prefix: jira/

workflow:
  mode: plan_execute_review
  max_review_cycles: 3
  require_plan_approval: true
  require_publish_approval: true

executors:
  defaults:
    planner: planner
    executor: executor
    reviewer: reviewer
  profiles:
    planner:
      driver: openai_compatible_api
      base_url: https://openrouter.ai/api/v1
      model: openai/gpt-5.4
      api_key_env: USER_OPENROUTER_API_KEY
      timeout_seconds: 120
      max_actions: 8
      temperature: 0.1
    executor:
      driver: openai_compatible_api
      base_url: https://openrouter.ai/api/v1
      model: openai/gpt-5.4-mini
      api_key_env: USER_OPENROUTER_API_KEY
      timeout_seconds: 120
      max_actions: 8
      temperature: 0.1
    reviewer:
      driver: openai_compatible_api
      base_url: https://openrouter.ai/api/v1
      model: openai/gpt-5.4-mini
      api_key_env: USER_OPENROUTER_API_KEY
      timeout_seconds: 120
      max_actions: 8
      temperature: 0.1
```

Important:

- the default `sandbox.image: arche-app:local` value is only a placeholder
- replace it with a real image available on your machine or VPS
- the image must contain what your repositories need: shell, git, runtime, package manager, build tools
- `read_only_rootfs`, `tmpfs_paths`, `cap_drop`, `no_new_privileges`, `pids_limit`, `memory_limit_mb`, and `cpus` harden Docker isolation without changing the VPS deployment model
- `env_allowlist` controls the only environment variables injected into the run container
- `allowed_commands` and `validation_commands` are now **exact tokenized commands**
- Arche no longer executes them through an implicit shell
- `pnpm test` therefore does not authorize `pnpm test --watch` or `pnpm test && ...`
- `routing.default_repository` is an optional fallback used only when no `repo-rule` matches the ticket
- `git.branch_prefix` controls generated branch names; with `jira/`, `PROJ-123` becomes `jira/PROJ-123-...`
- execution is now **API-only** and always uses the OpenRouter TypeScript SDK against `POST /chat/completions` for the selected profile on each role
- `planner` and `reviewer` are direct structured calls; `executor` runs through a bounded patch loop controlled by Arche

## First Useful Setup

### 1. Check the local environment

```bash
arche doctor
```

This command currently checks:

- `git`
- `docker`
- SQLite connectivity
- local availability of the sandbox Docker image
- warnings for containerized setups combining `docker.sock` with relative paths

### 2. Register a repository

```bash
arche repositories add \
  --name my-service \
  --remote-url git@gitlab.example.com:team/my-service.git \
  --local-mirror-path ./runtime/repos/my-service \
  --default-branch main \
  --gitlab-project-id team%2Fmy-service
```

Recommendations:

- `local-mirror-path` should point to a stable local path
- `gitlab-project-id` is strongly recommended for merge request creation
- for GitLab, this is usually the URL-encoded project identifier, for example `team%2Fmy-service`

### 3. Verify execution profiles

If you configured a default profile:

```bash
arche profiles show
```

### 4. Add a repository routing rule

Arche resolves the target repository through `repo-rules`.
A rule can filter by:

- Jira project
- label
- issue type

If no rule matches and `routing.default_repository` is set, Arche falls back to that repository.

Example:

```bash
arche repo-rules add \
  --name proj-bugs \
  --repository my-service \
  --jira-project-key PROJ \
  --label agent-ready \
  --issue-type Bug \
  --priority 100
```

### 5. Verify what is registered

```bash
arche repositories list
arche profiles show
arche repo-rules list
arche runs list
```

## Start Arche

In one terminal:

```bash
arche serve --port 8787
```

`arche serve` now binds on `127.0.0.1` by default.
For a remote API, set `ARCHE_SERVER_HOST=0.0.0.0` or pass `--host 0.0.0.0`, and configure `ARCHE_SERVER_AUTH_TOKEN`.

In a second terminal:

```bash
arche worker
```

In a third terminal, if you want the live operator view:

```bash
arche dashboard
```

## Verify the API

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ready
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/runs
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/runs/<run-id>/logs
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/runs/<run-id>/events
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/runs/<run-id>/commands
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/repositories
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/profiles
curl -H "Authorization: Bearer ${ARCHE_SERVER_AUTH_TOKEN}" http://127.0.0.1:8787/repo-rules
```

## Run Your First Ticket

### Manual run

```bash
arche runs manual PROJ-123
```

Force override for an operator:

```bash
arche runs manual PROJ-123 --force
```

Preconditions:

- Jira configured
- ticket exists
- ticket is eligible under the configured policy
- no active run already exists for the ticket
- the selected execution profiles are configured
- at least one `repo-rule` that resolves the repository

`--force` bypasses the eligibility policy and active-run guard, but it still requires Jira to be configured, the ticket to exist, the execution profiles to be configured, and a repository rule to resolve the ticket.

### Inspect a run

```bash
arche runs inspect <run-id>
arche runs logs <run-id> --kind all
```

### Monitor workers live

```bash
arche dashboard
```

The dashboard is a read-only terminal UI. It shows:

- all registered workers at the top
- the selected worker's current state and current ticket
- recent runs previously handled by that worker
- a read-only transcript, events, commands, and recent logs for the current run

`runs inspect` returns run details, retained debug paths (`worktree_path`, `artifacts_path`), and the most recent useful logs and events.

By default, the ticket must satisfy the policy from [orchestrator.yml](./orchestrator.yml):

- assigned to `agent-dev`
- status `In Progress`
- label `agent-ready`
- allowed issue type
- sufficiently long description

### Jira webhook

The server exposes:

- `POST /webhooks/jira`

Example:

```bash
curl -X POST http://127.0.0.1:8787/webhooks/jira \
  -H 'content-type: application/json' \
  -d '{"issue":{"key":"PROJ-123"}}'
```

There is no webhook signing or `Referer` check: anyone who can reach this URL can post. Keep the server on `127.0.0.1` for local use, or protect the route at your edge before exposing it publicly.

### View run logs

```bash
arche runs logs <run-id>
arche runs logs <run-id> --kind logs
arche runs logs <run-id> --kind events --json
arche runs logs <run-id> --kind commands --json
arche runs logs <run-id> --follow
```

Notes:

- `logs` exposes the human-readable `system|stdout|stderr` stream
- `events` exposes the structured machine audit trail for the run
- `commands` exposes command history with excerpts and artifact paths
- full command output is written to `runtime/logs/runs/<run-id>/commands/`

## VPS Deployment

### Option 1. Node processes on the host

Recommended and supported beta mode.

```bash
npm install
npm run build
arche init --yes --force
arche doctor
export ARCHE_SERVER_HOST=0.0.0.0
export ARCHE_SERVER_AUTH_TOKEN=change-me
arche serve --host 0.0.0.0 --port 8787
arche worker
```

### Option 2. Docker Compose

The repository already includes [docker-compose.yml](./docker-compose.yml) and [Dockerfile](./Dockerfile), but this mode is **secondary**.

Before `docker compose up`, run `arche init` (or create `.arche/environment` yourself) with **absolute** paths:

```env
ARCHE_RUNTIME_ROOT=/srv/arche/runtime
ARCHE_CONFIG_PATH=/srv/arche/orchestrator.yml
DATABASE_URL=/srv/arche/runtime/arche.db
ARCHE_SERVER_HOST=0.0.0.0
ARCHE_SERVER_AUTH_TOKEN=change-me
```

```bash
docker compose up --build
```

Notes:

- the `server` service now binds on `0.0.0.0` explicitly through `ARCHE_SERVER_HOST`
- `ARCHE_SERVER_AUTH_TOKEN` is required for any non-loopback bind, including Docker Compose
- the `worker` service mounts `/var/run/docker.sock`
- this is required to create per-run Docker sandboxes
- `orchestrator.yml` and `runtime/` must be mounted at the **same absolute path** on both host and container
- the image declared in `sandbox.image` must still be available for the run sandboxes themselves
- if you want the most stable path today, use `server` + `worker` directly on the host

## Useful Commands

```bash
arche init
arche init --yes --force
arche doctor
arche repositories list
arche repositories add --name repo --remote-url git@gitlab.example.com:group/repo.git --local-mirror-path ./runtime/repos/repo --gitlab-project-id group%2Frepo
arche profiles show
arche repo-rules list
arche repo-rules add --name proj-bugs --repository my-service --jira-project-key PROJ --label agent-ready --issue-type Bug
arche runs list
arche runs manual PROJ-123
arche runs manual PROJ-123 --force
arche runs logs <run-id>
arche runs logs <run-id> --kind all --follow
arche runs logs <run-id> --kind commands --json
arche runs retry <run-id>
arche runs cancel <run-id>
arche serve --port 8787
arche worker
```

## HTTP Endpoints Exposed by `arche serve`

- `GET /health`
- `GET /ready`
- `GET /runs`
- `GET /runs/{id}`
- `GET /runs/{id}/logs`
- `GET /runs/{id}/events`
- `GET /runs/{id}/commands`
- `POST /runs/manual`
- `POST /runs/{id}/retry`
- `POST /runs/{id}/cancel`
- `GET /repo-rules`
- `POST /repo-rules`
- `GET /repositories`
- `POST /repositories`
- `GET /profiles`
- `POST /webhooks/jira`

`POST /runs/manual` accepts:

```json
{
  "ticketKey": "PROJ-123",
  "force": false
}
```

## Current Verification Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```
