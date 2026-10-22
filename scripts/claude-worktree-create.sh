#!/usr/bin/env bash
set -euo pipefail

name="$(jq -r '.name')"
root="$(git rev-parse --show-toplevel)"
cd "$root"

if command -v treehouse >/dev/null 2>&1; then
  path="$(treehouse get --lease --lease-holder "claude-${name}")"
else
  path="${root}/.claude/worktrees/${name}"
  git worktree add --detach "$path" origin/main >&2
  cp .env "${path}/.env" 2>/dev/null || true
fi

echo "$path"
