#!/usr/bin/env bash
# 启动中心。前台运行；systemd 单位文件也指向这里。
# 会自动加载 ~/.config/notify-hub/env（模型/端口等环境变量）。
set -euo pipefail

cd "$(dirname "$0")/.."

# 让 node / pnpm 可用（nvm 装在 ~/.nvm 时）
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# 机器专属环境变量（可选；systemd 下由 EnvironmentFile 提供，这里再读一次也无害）
ENV_FILE="${NOTIFY_ENV_FILE:-$HOME/.config/notify-hub/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

exec node --import tsx apps/server/src/main.ts
