#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f "${NOTIFS_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/notifs}/env" ]; then
  set -a
  . "${NOTIFS_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/notifs}/env"
  set +a
fi
exec node --import tsx apps/server/src/main.ts
