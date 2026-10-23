#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

slot="$(basename "$(dirname "$root")")"
if [[ ! "$slot" =~ ^[0-9]+$ ]]; then
  echo "worktree-setup: $root is not a treehouse slot" >&2
  exit 1
fi

source "$root/scripts/bootstrap.sh"
ensure_env

set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" .env
}

postgres_port="$(get_env POSTGRES_PORT)"
postgres_port="${postgres_port:-5432}"
redis_port="$(get_env REDIS_PORT)"
redis_port="${redis_port:-6379}"
database="answerline_wt${slot}"

set_env COMPOSE_PROJECT_NAME answerline
set_env PORT "$((3000 + slot))"
set_env DATABASE_URL "postgres://answerline:answerline@localhost:${postgres_port}/${database}"
set_env REDIS_URL "redis://localhost:${redis_port}"
set_env REDIS_PREFIX "bull-wt${slot}"
set_env AGENT_NAME "answerline-wt${slot}"

install_dependencies

if docker compose exec -T postgres pg_isready -U answerline >/dev/null 2>&1; then
  exists="$(docker compose exec -T postgres psql -U answerline -d answerline -tAc "select 1 from pg_database where datname = '${database}'")"
  if [[ "$exists" != "1" ]]; then
    docker compose exec -T postgres createdb -U answerline "$database"
  fi
  pnpm db:migrate
  pnpm db:seed
else
  echo "worktree-setup: postgres is not running; run 'pnpm infra:up' then 'pnpm db:migrate && pnpm db:seed'" >&2
fi

echo "worktree-setup: slot ${slot} ready (web :$((3000 + slot)), db ${database}, agent answerline-wt${slot})"
