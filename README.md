# notify-hub

通用提醒系统：**管理监控程序 → 按固定格式接收事件 → 路由 → 转发到任意 channel → 各端弹通知。**

设计基准见 [`技术方案.md`](./技术方案.md)；监控程序接入规范见
[`docs/producer-protocol.md`](./docs/producer-protocol.md)。

> 当前进度：**C1 内核已跑通** —— CLI 注入一条事件 → 桌面系统通知 + 任意 Webhook 均收到。

## 目录

- `packages/` — 框架
  - `contracts/` — 事件信封、规则/通道的 zod schema 与类型（唯一契约源）
  - `store/` — SQLite 数据层（better-sqlite3 + WAL）+ 迁移
  - `core/` — 规则匹配、去重、模板渲染、退避
  - `channels/` — 通知出口实现（`local` 桌面通知、`webhook` 任意 HTTP）
- `apps/`
  - `server/` — Fastify：Ingest API + outbox 投递 worker
  - `cli/` — 管理 / 调试 CLI
- `docs/` — 规范与说明
- `tests/` — vitest 测试

## 环境

Node ≥ 20（开发用 24）、pnpm 10。首次安装会编译 `better-sqlite3` 原生模块。

```sh
pnpm install
pnpm typecheck
pnpm test
```

## 跑起来

```sh
# 1) 起中心
NOTIFY_PORT=7711 pnpm start

# 2) 建演示用的源 + 通道 + 规则（打印 token）
pnpm cli dev-seed --webhook http://127.0.0.1:7799/hook

# 3) 注入一条事件
pnpm cli emit --server http://127.0.0.1:7711 --token <token> \
  --type github.pr.reply --text "PR 那边回复了"

# 4) 看投递记录
pnpm cli deliveries
```

数据默认落在 `./data/`（已 gitignore），可用 `NOTIFY_DATA_DIR` 覆盖。

## 数据模型速览

`events`（事件）→ `rules`（规则）→ `deliveries`（outbox 投递）→ `channels`（出口）。
投递语义为**至少一次**：失败按指数退避重试，超限进死信；进程崩溃后启动时重置卡住的投递并补发。
