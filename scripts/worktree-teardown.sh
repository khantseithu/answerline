#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

slot="$(basename "$(dirname "$root")")"
[[ "$slot" =~ ^[0-9]+$ ]] || exit 0

if grep -qx "PGX_DB=1" .env 2>/dev/null && command -v pgx >/dev/null; then
  if pgx url "answerline_wt${slot}" >/dev/null 2>&1; then
    pgx drop --force "answerline_wt${slot}"
  fi
elif docker compose exec -T postgres pg_isready -U answerline >/dev/null 2>&1; then
  docker compose exec -T postgres dropdb -U answerline --if-exists "answerline_wt${slot}"
fi
