#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

template="answerline_template"

if ! command -v pgx >/dev/null; then
  echo "pgx-template: pgx is not on PATH; install it with 'pnpm add -g pgxdb'" >&2
  exit 1
fi

pgx run >/dev/null
if pgx url "$template" >/dev/null 2>&1; then
  pgx drop --force "$template" >/dev/null
fi
PGX_ADMIN_URL="$(pgx url postgres)" \
  PGX_CREATE_SQL="create database ${template} template template0 locale_provider builtin builtin_locale 'C.UTF-8'" \
  pnpm --silent --filter @answerline/db exec node -e \
  'const sql = require("postgres")(process.env.PGX_ADMIN_URL); sql.unsafe(process.env.PGX_CREATE_SQL).finally(() => sql.end())'

DATABASE_URL="$(pgx url "$template")" pnpm db:migrate
DATABASE_URL="$(pgx url "$template")" pnpm db:seed

echo "pgx-template: ${template} rebuilt; new agent sessions branch from it"
