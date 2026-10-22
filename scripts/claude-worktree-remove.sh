#!/usr/bin/env bash
set -euo pipefail

path="$(jq -r '.worktree_path')"
[[ -d "$path" ]] || exit 0

if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
  echo "keeping ${path}: uncommitted changes" >&2
  exit 1
fi

if [[ -n "$(git -C "$path" rev-list HEAD --not --remotes -n 1)" ]]; then
  echo "keeping ${path}: commits not pushed to any remote" >&2
  exit 1
fi

if command -v treehouse >/dev/null 2>&1 && treehouse status --json | jq -e --arg p "$path" 'any(.[]; .path == $p)' >/dev/null; then
  treehouse return --force "$path" >&2
else
  git -C "$path" worktree remove "$path" >&2
fi
