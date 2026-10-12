# notify-hub

通用提醒系统：**管理监控程序 → 按固定格式接收事件 → 路由 → 转发到任意 channel → 各端弹通知。**

**主入口是命令行**（Web 管理界面是可选的附加物）。上手先看 [`docs/usage.md`](./docs/usage.md)。
设计基准见 [`技术方案.md`](./技术方案.md)；监控程序接入规范见
[`docs/producer-protocol.md`](./docs/producer-protocol.md)；各出口怎么拿凭据见 [`docs/channels.md`](./docs/channels.md)。

> 当前进度：内核 / 出口 / 监控程序托管 / 凭据加密 / CLI 管理 / 部署与重试硬化 都已就绪，
> **91 项测试**通过。Web 管理界面已实现但**暂不作为主形态**。
> 待办：规则测试器、时间管理（外围）。

## 目录

- `packages/` — 框架
  - `contracts/` — 事件信封、规则/通道/监控程序清单的 zod schema 与类型（唯一契约源）
  - `store/` — SQLite 数据层（better-sqlite3 + WAL）+ 迁移 + 密钥库/口令/会话
  - `core/` — 规则匹配、去重、模板渲染、退避
  - `channels/` — 通知出口（`local` / `webhook` / `ntfy` / `bark` / `wecom` / `feishu` / `feishu-app`）
  - `producers/` — 清单加载、Poller 引擎、登记同步、程序骨架、静态校验、试运行
  - `supervisor/` — managed 程序托管 + Poller 调度
  - `authoring/` — （可选）内置 Agent 生成监控程序
- `apps/`
  - `server/` — Fastify：Ingest API + 管理 API + outbox worker + supervisor + poller 调度
  - `cli/` — **主入口**：源/出口/规则/监控程序/凭据/备份 全部管理
  - `web/` — （可选）Web 管理界面，构建产物存在时才挂载
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

**你（或你的 agent）只写"发现变化 + 发 POST"这段逻辑，其余归 CLI 管：**

```sh
pnpm cli producer init my-watch     # ① 生成骨架（清单 + 入口 + README）
                                    # ② 填逻辑（见 producers/my-watch/README.md）
pnpm cli producer check my-watch    # ③ 静态校验：清单/入口/解释器/凭据
pnpm cli producer try my-watch      # ④ 试运行：真跑一遍，只打印"将会上报什么"（不入库不通知）
pnpm cli producer enable my-watch   # ⑤ 上线：中心拉起并看护
pnpm cli producer logs my-watch     # 看日志
pnpm cli producer rm my-watch --dir # 注销（含目录）
```

中心替你管：拉起、心跳（超 90s 判卡死重启）、崩溃退避重启、凭据注入、日志落盘、
以及"删掉目录后 `producer sync` 自动清理记录"。

- **managed**：中心拉起你的程序，注入 `NOTIFY_*` 环境变量与声明的凭据。
- **poller**：一段声明式配置，中心内建轮询、比对快照、命中变化才产出事件（不用写代码）。

接入细节见 [`docs/producer-protocol.md`](./docs/producer-protocol.md)。

## （可选）内置生成监控程序

不依赖它也能用上面的 producer 流程。需要时配一个 OpenAI 兼容端点：

```sh
export NOTIFY_LLM_MODEL=deepseek-flash                # 必填
export NOTIFY_LLM_BASE_URL=https://api.deepseek.com   # 默认官方 OpenAI 地址
export NOTIFY_LLM_API_KEY=<key>
pnpm cli llm check                                    # 探测连通与鉴权
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

## （可选）Web 管理界面

**不是主形态**，构建产物存在时才挂载（`apps/web/dist`）。CLI 覆盖全部功能。

```sh
pnpm build:web                                              # 构建界面
pnpm cli user init --username admin --password '<口令>'      # 创建登录用户
pnpm start
# 浏览器打开 http://127.0.0.1:7710/
```

覆盖：概览、事件流、监控程序、规则、出口、信息源、投递记录、Agent 生成、设置。
鉴权是单用户 + 会话 cookie。

## 部署（systemd --user）

```sh
mkdir -p ~/.config/notify-hub
cat > ~/.config/notify-hub/env <<'EOF'
# 按需填写；端口/数据目录也可在这里改
NOTIFY_LLM_MODEL=<模型名>
NOTIFY_LLM_BASE_URL=<OpenAI 兼容端点>
NOTIFY_LLM_API_KEY=<key>
EOF

mkdir -p ~/.config/systemd/user
cp deploy/notify-hub.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now notify-hub
loginctl enable-linger "$USER"          # 未登录也保持运行
journalctl --user -u notify-hub -f
```

## 备份与自检

```sh
pnpm cli backup --to ~/backups/notify-hub-$(date +%F)   # 数据库一致性快照 + 主密钥
pnpm cli llm check                                      # 探测模型端点连通与鉴权
tools/e2e-resend.sh                                     # 端到端验证"失败→重试→送达"
```

> `master.key` 是解密凭据的唯一钥匙，务必与备份一起保存；丢了它，库里已加密的凭据就解不开。

数据默认落在 `./data/`（已 gitignore），可用 `NOTIFY_DATA_DIR` 覆盖。

## 数据模型速览

`events`（事件）→ `rules`（规则）→ `deliveries`（outbox 投递）→ `channels`（出口）。
投递语义为**至少一次**：失败按指数退避重试，超限进死信；进程崩溃后启动时重置卡住的投递并补发。
