#!/usr/bin/env bash
# 启动中心（供 systemd / 手动调用）。会尝试加载 nvm 以便找到 node。
set -euo pipefail

cd "$(dirname "$0")/.."

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

exec node --import tsx apps/server/src/main.ts
