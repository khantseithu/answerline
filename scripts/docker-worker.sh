#!/bin/sh
set -eu
case "${1:-start}" in
  eval) cd /app/apps/worker; exec node --import tsx src/cli.ts "$@" ;;
  start) cd /app/apps/worker; exec node --import tsx src/index.ts ;;
  *) exec "$@" ;;
esac
