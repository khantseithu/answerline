#!/bin/sh
set -eu
case "${1:-start}" in
  eval) exec pnpm --filter @answerline/worker exec tsx src/cli.ts "$@" ;;
  start) exec pnpm --filter @answerline/worker start ;;
  *) exec "$@" ;;
esac
