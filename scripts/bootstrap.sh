#!/usr/bin/env bash
set -euo pipefail

ensure_env() {
  [[ -f .env ]] || cp .env.example .env
}

get_env() {
  grep "^$1=" .env | tail -1 | cut -d= -f2- || true
}

install_dependencies() {
  pnpm install --frozen-lockfile --prefer-offline
  uv sync --locked
}

bootstrap() {
  local root step="checking prerequisites" tool python_found=false python version key value service container health attempt
  trap 'echo "bootstrap: failed while ${step}; fix the error above and rerun pnpm bootstrap." >&2' ERR
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$root"

  for tool in docker node pnpm uv; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      case "$tool" in
        docker) echo "bootstrap: install Docker with Compose: https://docs.docker.com/get-started/get-docker/" >&2 ;;
        node) echo "bootstrap: install Node 24: https://nodejs.org/" >&2 ;;
        pnpm) echo "bootstrap: install pnpm: https://pnpm.io/installation" >&2 ;;
        uv) echo "bootstrap: install uv: https://docs.astral.sh/uv/getting-started/installation/" >&2 ;;
      esac
      return 1
    fi
  done
  if [[ "$(node --version)" != v24.* ]]; then
    echo "bootstrap: Node 24 is required; install or select it: https://nodejs.org/" >&2
    return 1
  fi
  for python in python3.13 python3 python; do
    if command -v "$python" >/dev/null 2>&1; then
      version="$("$python" --version 2>&1)"
      if [[ "$version" == 'Python 3.13.'* ]]; then
        python_found=true
        break
      fi
    fi
  done
  if [[ "$python_found" != true ]]; then
    echo "bootstrap: Python 3.13 is required; run 'uv python install 3.13' and add its bin directory to PATH." >&2
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "bootstrap: install Docker Compose: https://docs.docker.com/compose/install/" >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "bootstrap: Docker is not running; start Docker Desktop or your Docker daemon and retry." >&2
    return 1
  fi

  step="preparing .env"
  ensure_env
  for key in DEEPGRAM_API_KEY ANTHROPIC_API_KEY CARTESIA_API_KEY; do
    value="$(get_env "$key")"
    value="${value//[[:space:]]/}"
    if [[ -z "$value" || "$value" == '""' || "$value" == "''" || "$value" == \#* ]]; then
      echo "bootstrap: warning: $key is empty in .env; set it before making calls." >&2
    fi
  done

  step="installing dependencies"
  install_dependencies
  step="starting infrastructure"
  pnpm infra:up
  step="waiting for Postgres and Redis health"
  for service in postgres redis; do
    container="$(docker compose ps -q "$service")"
    if [[ -z "$container" ]]; then
      echo "bootstrap: $service has no running container; inspect 'docker compose logs $service'." >&2
      return 1
    fi
    for ((attempt = 0; attempt < 60; attempt++)); do
      health="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
      [[ "$health" != healthy ]] || break
      if [[ "$health" == unhealthy ]]; then
        echo "bootstrap: $service is unhealthy; inspect 'docker compose logs $service'." >&2
        return 1
      fi
      sleep 2
    done
    if [[ "$health" != healthy ]]; then
      echo "bootstrap: timed out waiting for $service health; inspect 'docker compose logs $service'." >&2
      return 1
    fi
  done
  step="migrating the database"
  pnpm db:migrate
  step="seeding the database"
  pnpm db:seed
  trap - ERR
  printf '\nbootstrap: ready. Add any missing provider keys to .env, then run:\n  pnpm dev        # web + worker\n  pnpm agent:dev  # voice agent, in a separate terminal\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -E
  bootstrap "$@"
fi
