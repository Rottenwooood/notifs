#!/usr/bin/env bash
# 端到端验证「出口暂时不可用 → 自动重试 → 最终送达」。
# 用法: tools/e2e-resend.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT_HUB=7791
PORT_HOOK=7792
WORK="$(mktemp -d /tmp/nh-resend-XXXXXX)"
export NOTIFY_DATA_DIR="$WORK/data"
mkdir -p "$NOTIFY_DATA_DIR"

cleanup() {
  [ -n "${HUB_PID:-}" ] && kill "$HUB_PID" 2>/dev/null || true
  [ -n "${HOOK_PID:-}" ] && kill "$HOOK_PID" 2>/dev/null || true
  sleep 0.5
}
trap cleanup EXIT

# 出口：前 2 次返回 500（可重试失败），第 3 次成功
cat > "$WORK/hook.mjs" <<'JS'
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
let n = 0;
createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    n += 1;
    writeFileSync(process.env.COUNT_FILE, String(n));
    if (n <= 2) {
      res.writeHead(500);
      res.end('boom');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }
  });
}).listen(Number(process.env.PORT), '127.0.0.1');
JS

COUNT_FILE="$WORK/count"
PORT="$PORT_HOOK" COUNT_FILE="$COUNT_FILE" node "$WORK/hook.mjs" &
HOOK_PID=$!
sleep 1

NOTIFY_PORT="$PORT_HUB" NOTIFY_LOG_LEVEL=warn node --import tsx apps/server/src/main.ts &
HUB_PID=$!
sleep 4

TOKEN=$(pnpm cli dev-seed --webhook "http://127.0.0.1:$PORT_HOOK/hook" 2>/dev/null | grep -o '"token": "[^"]*"' | cut -d'"' -f4)
# dev-seed 的默认规则已经把事件发给 local 与 hook，无需再加

pnpm cli emit --server "http://127.0.0.1:$PORT_HUB" --token "$TOKEN" \
  --type e2e.resend --text '重试验证' >/dev/null

echo "等待重试窗口（首次退避 5s 起）…"
ATTEMPTS=0
for _ in $(seq 1 45); do
  ATTEMPTS=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
  [ "${ATTEMPTS:-0}" -ge 3 ] && break
  sleep 2
done

SENT=$(curl -s "http://127.0.0.1:$PORT_HUB/health" | grep -o '"sent":[0-9]*' | cut -d: -f2)
echo "出口收到的请求次数：$ATTEMPTS（前 2 次返回 500，第 3 次才成功）"
echo "送达计数 sent：${SENT:-0}"

if [ "${SENT:-0}" -ge 1 ] && [ "${ATTEMPTS:-0}" -ge 3 ]; then
  echo "PASS：前两次失败被自动重试，第三次成功送达。"
else
  echo "FAIL：未达到预期（需要出口被重试到第 3 次且最终送达）。"
  exit 1
fi
