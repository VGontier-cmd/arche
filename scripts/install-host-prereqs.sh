#!/usr/bin/env bash
# Best-effort installer for common Arche host dependencies (git, Node 22+, Docker daemon).
# Requires explicit consent for package installs. Comments and output are in English.
#
# Usage:
#   bash scripts/install-host-prereqs.sh           # prompts before installing
#   bash scripts/install-host-prereqs.sh --yes     # non-interactive (macOS Homebrew / Debian apt only)
#
# Limitations:
# - Cannot reliably auto-install Docker on every Linux distro; Debian/Ubuntu (apt) is supported with --yes + sudo.
# - On macOS, Docker Desktop must finish starting after install (first launch can take a minute).

set -euo pipefail

YES=0
if [[ "${1:-}" == "--yes" ]]; then
  YES=1
fi

MIN_NODE_MAJOR=22

die() {
  echo "error: $*" >&2
  exit 1
}

confirm() {
  local msg=$1
  if [[ "$YES" -eq 1 ]]; then
    return 0
  fi
  read -r -p "$msg [y/N] " reply || true
  [[ "${reply:-}" =~ ^[Yy]$ ]]
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

node_major() {
  if ! have_cmd node; then
    echo 0
    return
  fi
  node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0
}

docker_server_ok() {
  have_cmd docker && docker version --format '{{.Server.Version}}' >/dev/null 2>&1
}

ensure_brew() {
  if have_cmd brew; then
    return 0
  fi
  die "Homebrew is not installed. Install it from https://brew.sh then re-run this script."
}

install_macos_git() {
  ensure_brew
  if have_cmd git; then
    return 0
  fi
  confirm "Install git via Homebrew?" || die "git is required"
  brew install git
}

install_macos_node() {
  ensure_brew
  local major
  major=$(node_major)
  if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then
    return 0
  fi
  confirm "Install Node.js ${MIN_NODE_MAJOR}+ via Homebrew (formula: node)?" || die "Node.js ${MIN_NODE_MAJOR}+ is required"
  brew install node
  major=$(node_major)
  if [[ "$major" -lt "$MIN_NODE_MAJOR" ]]; then
    die "After brew install, node is still < ${MIN_NODE_MAJOR}. Install a newer node (e.g. fnm/nvm) and retry."
  fi
}

install_macos_docker() {
  ensure_brew
  if docker_server_ok; then
    echo "Docker daemon is already reachable."
    return 0
  fi

  if ! have_cmd docker; then
    confirm "Install Docker Desktop via Homebrew Cask (brew install --cask docker)?" || die "Docker is required"
    brew install --cask docker
  fi

  if docker_server_ok; then
    return 0
  fi

  echo "Docker CLI is present but the daemon is not running."
  if confirm "Try to open Docker Desktop (open -a Docker)?"; then
    open -a Docker || true
    echo "Waiting for Docker daemon (up to ~120s)…"
    for _ in $(seq 1 40); do
      sleep 3
      if docker_server_ok; then
        echo "Docker daemon is up."
        return 0
      fi
    done
    die "Docker daemon still not reachable. Finish Docker Desktop setup in the UI, then run: docker version"
  fi
  die "Start Docker Desktop manually, then run: arche doctor"
}

install_linux_git() {
  if have_cmd git; then
    return 0
  fi
  if have_cmd apt-get && [[ "$YES" -eq 1 ]]; then
    sudo apt-get update -y
    sudo apt-get install -y git
    return 0
  fi
  die "Install git with your distro package manager, then re-run."
}

install_linux_node() {
  local major
  major=$(node_major)
  if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then
    return 0
  fi
  if have_cmd apt-get && [[ "$YES" -eq 1 ]]; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl
    # NodeSource setup for 22.x — documented install path for Debian/Ubuntu
    if ! have_cmd node || [[ "$major" -lt "$MIN_NODE_MAJOR" ]]; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
    major=$(node_major)
    if [[ "$major" -lt "$MIN_NODE_MAJOR" ]]; then
      die "Node.js is still < ${MIN_NODE_MAJOR}. Install Node 22+ manually."
    fi
    return 0
  fi
  die "Install Node.js ${MIN_NODE_MAJOR}+ (https://nodejs.org or your distro), then re-run. On Debian/Ubuntu you can use: bash scripts/install-host-prereqs.sh --yes"
}

install_linux_docker() {
  if docker_server_ok; then
    echo "Docker daemon is already reachable."
    return 0
  fi

  if have_cmd apt-get && [[ "$YES" -eq 1 ]]; then
    confirm "Install Docker Engine via apt (docker.io) and start the service?" || die "Docker is required"
    sudo apt-get update -y
    sudo apt-get install -y docker.io
    if have_cmd systemctl; then
      sudo systemctl enable --now docker || sudo service docker start || true
    fi
    if docker_server_ok; then
      echo "Docker is ready."
      return 0
    fi
    die "Docker package installed but daemon not reachable. Check: sudo systemctl status docker"
  fi

  if have_cmd docker; then
    die "Docker CLI found but daemon is not running. Start it (e.g. sudo systemctl start docker) or see https://docs.docker.com/engine/install/"
  fi

  die "Automatic Docker install is only wired for apt-based distros with --yes. See https://docs.docker.com/engine/install/"
}

optional_npm_install() {
  if [[ -f package.json ]] && confirm "Run npm install in $(pwd)?"; then
    npm install
  fi
}

OS=$(uname -s)
echo "Detected OS: $OS"
echo "This script installs or verifies: git, Node.js ${MIN_NODE_MAJOR}+, Docker (daemon reachable)."

case "$OS" in
  Darwin)
    install_macos_git
    install_macos_node
    install_macos_docker
    ;;
  Linux)
    install_linux_git
    install_linux_node
    install_linux_docker
    ;;
  *)
    die "Unsupported OS for automated install. Install git, Node ${MIN_NODE_MAJOR}+, and Docker manually, then run: arche doctor"
    ;;
esac

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
if [[ -f "$REPO_ROOT/package.json" ]]; then
  (cd "$REPO_ROOT" && optional_npm_install) || true
fi

echo "Done. Verify with: arche doctor (after npm run build / npm link if needed)."
