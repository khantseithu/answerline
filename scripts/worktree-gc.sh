#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --prune origin

treehouse status --json | jq -r '.[] | select(.status == "leased" and (.lease_holder | startswith("claude-"))) | .path' |
  while read -r path; do
    if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
      echo "keep    ${path} (uncommitted changes)"
    elif [[ -n "$(git -C "$path" rev-list HEAD --not --remotes -n 1)" ]]; then
      echo "keep    ${path} (unpushed commits)"
    else
      treehouse return --force "$path" >/dev/null 2>&1 && echo "return  ${path}"
    fi
  done
