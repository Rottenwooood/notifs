<div align="center">

# notifs

**面向人、程序与 AI Agent 的自托管订阅通信中心。**

**Compatibility:** adapted to OpenCode `2.x` & MCP (`@modelcontextprotocol/sdk`).

![CI](https://img.shields.io/github/actions/workflow/status/Rottenwooood/notifs/ci.yml?branch=main&label=CI) ![License](https://img.shields.io/badge/license-MIT-blue) ![npm version](https://img.shields.io/npm/v/notifs) ![npm downloads](https://img.shields.io/npm/dw/notifs) ![Version](https://img.shields.io/github/v/tag/Rottenwooood/notifs?label=version) ![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

---
</div>

`notifs` 将人、程序与 AI Agent 抽象为对等的通信节点。任何参与者仅需持有身份凭据（Token）即可单向发布 `{ type, content }` 消息；中心根据订阅规则将消息持久化、攒批限频，并主动推送到目标适配器。

核心不预设团队角色、任务流或会话锁，所有协作拓扑均由“身份 + 目标 + 订阅”自由拼装而成。

```text
人 / 程序 / Agent ── HTTP · Unix IPC · MCP ──→ 身份认证与发布 (type + content)
                                                     │
                                             订阅匹配与持久化队列
                                                     │
                                             按目标攒批 · 限频 · 主动交付
                                                     ↓
                              程序 Webhook  /  Agent 宿主非用户通道  /  人类通知渠道

```

## 核心特性

* **纯单向通信与自由拓扑**：全员采用 Fire-and-Forget 单向发信，发送即结束当前轮次，无同步阻塞等待。通过组合订阅规则，可随时搭建“Agent 直发飞书”、“飞书双向对话 Agent”、“Agent 静默监听程序事件”、“多 Agent 自由点对点”，或是“主从式 Agent 架构（人只与主 Agent 交流，主 Agent 编排并调度子 Agent）”。
* **AI Native 接入边界**：
  * **中心 → Agent**：通过宿主专用的非 `user_prompt` 接口（如 OpenCode `/synthetic`）注入上下文，并以 `<agent-messages>` 显式标记不可信数据边界，从根源隔离提示词注入。
  * **Agent → 中心**：Agent 通过 MCP `send` 或 HTTP/IPC 显式发信，中心不解析模型最终文本或思维链。
* **动态拓扑编排**：授予 `--manager` 权限的主 Agent 可直接通过 MCP 工具动态创建身份、注册目标、修改订阅，自主安排子 Agent 的分工与通信链路。


* **内核保真与边缘渲染**：内核全程保留原始 JSON 结构，按目标独立控制攒批窗口（`max_wait_ms`、`max_messages`、`max_bytes`）与发送间隔（`min_interval_ms`）。程序收到完整结构化批次，Agent 收到合并后的单次上下文注入，人类渠道则在适配器边缘渲染为通知卡片或文本。
* **对称且易扩展的 Adapter 架构**：接入新平台或自建可视化前端，只需编写独立的入站发布桥（Event → `send`）或注册出站交付器（`Batch` → Delivery），无需改动核心路由与存储。
* **单机持久化与可靠交付**：基于 SQLite WAL 原子落盘消息与各目标的投递责任。中心内部驱动租约续期、失败重试、挂起（Held）与恢复（Resume），支持在线热备份与过期消息自动清理。

## 快速开始

### 安装与启动

通过 npm 全局安装：

```sh
npm install -g notifs
notifs init
notifs start

```

或从源码构建运行：

```sh
pnpm install && pnpm build
node dist/cli.mjs init
node dist/cli.mjs start

```

支持生成 systemd 用户级服务实现常驻运行：

```sh
notifs service install
systemctl --user daemon-reload
systemctl --user enable --now notifs

```

### 30 秒拼装一条通信链路

`notifs init` 会生成根控制者凭据（默认身份为 `owner`）。下面演示如何创建一个工作身份、绑定 Webhook 接收端、配置订阅并发送消息：

```sh
# 1. 创建普通身份与具备拓扑编排权限的管理身份
notifs identity add worker
notifs identity add coordinator --manager

# 2. 为 worker 配置接收目标（Webhook 适配器）
notifs endpoint put --config '{
  "name": "worker-hook",
  "owner": "worker",
  "delivery": {
    "kind": "webhook",
    "config": { "url": "http://127.0.0.1:9000/messages" }
  }
}'

# 3. 配置订阅：将 owner 发出的 job 类型消息路由给 worker-hook
notifs subscription put --config '{
  "name": "dispatch-jobs",
  "endpoint": "worker-hook",
  "source": "owner",
  "type": "job.*"
}'

# 4. 单向发送消息（支持文本或任意 JSON 结构）
notifs message send --type job.compile --content '{"repo":"notifs","branch":"main"}'

```

## 典型拼装模式

通过调整 `endpoint` 与 `subscription`（支持 `source`/`type` 通配符及 `content` 字段级 `eq`/`ne`/`in`/`exists`/`gt`/`lt` 过滤），可以组合出任意工作流：

| 协作模式 | 拓扑配法 |
| --- | --- |
| **任务完成通知** | Agent / 脚本调用 `send` → 订阅匹配 `type="report"` → 投递至 `feishu` / `bark` / `ntfy` |
| **人类遥控 Agent** | `notifs-feishu-inbound` 监听群聊/@消息并发布 `human.message` → 投递至 `opencode` 会话；Agent 通过 MCP `send` 发回 `reply` 或 `question` → 投递至 `feishu-app` |
| **事件驱动守卫** | 监控脚本持续发布系统指标 → 订阅配置条件 `stats.failed > 0` → 仅在异常时唤醒修复 Agent |
| **主从动态编排** | 人与主 Agent（持 `--manager` 凭据）交流 → 主 Agent 调用 MCP `set_subscription` 动态连接多个子 Agent 协同处理，完成后汇总回传人类 |

## 接入矩阵

### 入站（发布与管理）

所有入站方式共用同一套身份认证、幂等键（`Idempotency-Key`）与订阅路由语义。可选参数 `to` 用于在订阅结果内进一步缩小接收范围。

* **HTTP API**：`POST /api/messages`，携带 `Authorization: Bearer <token>`。
* **Unix Socket IPC**：同机低延迟通道（默认 `notifs.sock`），CLI 与 MCP 均可通过 `--socket` 直连。
* **MCP Server**：运行 `notifs mcp`。所有身份可用 `send`、`inspect`；管理身份额外解锁 `create_identity`、`set_endpoint`、`set_subscription` 等全套编排工具。
* **平台入站 Bridge**：独立进程 `notifs-feishu-inbound`，支持飞书长连接（无需公网 IP）与 HTTP 回调，自动过滤无关群聊并携带幂等键发布 `human.message`。

### 出站（Delivery Adapters）

同一个身份可绑定多个接收目标，各目标独立配置攒批与限频参数：

* **AI Agent 宿主**：`opencode`（调用 OpenCode 2.x `/api/session/{id}/synthetic` 接口，支持 `steer` / `queue` 模式）。
* **程序与自定义前端**：`webhook`（附带批次 `Idempotency-Key` POST 完整 JSON 批次，返回 2xx 即确认接管）。
* **即时通讯与推送**：`feishu`（飞书自定义机器人，支持加签与 @）、`feishu-app`（飞书企业应用机器人，支持单聊/群聊/富文本）、`wecom`（企业微信机器人）、`bark`（iOS 推送）、`ntfy`（自建/移动端推送）、`local`（Linux `notify-send` 桌面通知与日志回退）。

## 文档导航

* [具体配置与适配器参数](docs/configuration.md)
* [MCP 接入与编排指南](docs/mcp.md)
* [Agent 接入契约](integrations/agent/README.md)
* [架构设计](docs/design/notifs.md) · [系统边界说明](docs/boundaries.md) · [部署说明](deploy/README.md)

## License

[MIT](LICENSE)
