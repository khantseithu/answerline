#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

slot="$(basename "$(dirname "$root")")"
[[ "$slot" =~ ^[0-9]+$ ]] || exit 0

if docker compose exec -T postgres pg_isready -U answerline >/dev/null 2>&1; then
  docker compose exec -T postgres dropdb -U answerline --if-exists "answerline_wt${slot}"
fi
