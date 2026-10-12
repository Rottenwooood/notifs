# notify-hub

通用提醒系统：**管理监控程序 → 按固定格式接收事件 → 路由 → 转发到任意 channel → 各端弹通知。**

设计基准见 [`技术方案.md`](./技术方案.md)；监控程序接入规范见
[`docs/producer-protocol.md`](./docs/producer-protocol.md)。

> 当前进度：**C1 内核 + C2 出口 + C3 监控程序托管 + C4 Agent 生成 已跑通** ——
> CLI 注入事件 → 桌面通知 + Webhook；托管程序与内建 poller 都能产出事件、崩溃自动重启、
> 断点续传；一句话需求 → agent 生成监控程序 → 静态检查 → 试运行 → 审批上线。

## 目录

- `packages/` — 框架
  - `contracts/` — 事件信封、规则/通道/监控程序清单的 zod schema 与类型（唯一契约源）
  - `store/` — SQLite 数据层（better-sqlite3 + WAL）+ 迁移
  - `core/` — 规则匹配、去重、模板渲染、退避
  - `channels/` — 通知出口（`local` / `webhook` / `ntfy` / `bark` / `wecom`）
  - `producers/` — 清单加载、Poller 引擎、登记同步
  - `supervisor/` — managed 程序托管 + Poller 调度
  - `authoring/` — Agent 生成监控程序（LLM 提供方、解析、静态检查、试运行、审批）
- `apps/`
  - `server/` — Fastify：Ingest API + outbox worker + supervisor + poller 调度
  - `cli/` — 管理 / 调试 CLI
- `producers/` — 你实际要跑的监控程序（`github-pr/` 是样板，默认禁用）
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

## 管理监控程序

监控程序是磁盘上的目录（`producers/<slug>/producer.json` + 代码），**文件系统是"存在哪些程序"
的期望状态**；中心启动时同步进 DB 并按 `enabled` 拉起。

```sh
pnpm cli producer sync            # 扫描 producers/*/producer.json
pnpm cli producer list            # 状态 / pid / 重启次数
pnpm cli producer enable <slug>   # 或 disable
pnpm cli producer logs <slug>     # 读 state_dir/hub.log
```

- **managed**：中心拉起你的程序，注入 `NOTIFY_*` 环境变量与声明的凭据；崩溃/心跳超时自动退避重启。
- **poller**：一段声明式配置，中心内建轮询、比对快照、命中变化才产出事件。

接入细节见 [`docs/producer-protocol.md`](./docs/producer-protocol.md)。

## 让 agent 生成监控程序（C4）

配置一个 OpenAI 兼容的模型端点即可：

```sh
export NOTIFY_LLM_MODEL=<模型名>                 # 必填
export NOTIFY_LLM_BASE_URL=<兼容端点>            # 默认官方地址
export NOTIFY_LLM_API_KEY=<key>
```

然后：

```sh
pnpm cli author new "监控 <某地址>，有变化就通知我"   # 生成草稿（信息不足会先反问）
pnpm cli author show <slug>                         # 看代码 / README / 声明的凭据
pnpm cli author check <slug>                        # 静态检查
pnpm cli author try <slug> --seconds 15             # 试运行：只打印"将会上报的事件"
pnpm cli author approve <slug>                      # 审核通过 → 复制到监控程序区并启用
pnpm cli author reject <slug> --reason "..."
```

审批上线后**无需重启**：中心的目录监听会自动登记并拉起它。

数据默认落在 `./data/`（已 gitignore），可用 `NOTIFY_DATA_DIR` 覆盖。

## 数据模型速览

`events`（事件）→ `rules`（规则）→ `deliveries`（outbox 投递）→ `channels`（出口）。
投递语义为**至少一次**：失败按指数退避重试，超限进死信；进程崩溃后启动时重置卡住的投递并补发。
