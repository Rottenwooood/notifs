# notifs 边界：当前 0.2 与旧版能力

本文按“所有面”列边界，不展开每个字段的实现细节。当前代码指本仓库 `0.2.0`；旧版指已从 relay 删除的 `notifs` 1.x/旧发布包。

## 1. 一句话边界

当前 notifs 是**单节点、自托管、身份 + 订阅 + 主动推送**的通信中心：

- 参与者：人、程序、agent。
- 入口：HTTP、Unix socket IPC、MCP stdio、CLI、飞书入站 bridge。
- 出口：程序 webhook、agent 宿主输入、人类通知渠道。
- 核心只认识 `type + content`、身份、目标、订阅、投递状态。
- 不内置任务、会话、角色、回复线程、因果链、审批或工作流。

旧版是**通知中继 + 规则引擎 + 托管程序平台**，两者不是同一套能力模型。旧版的服务、包和 API 已从 relay 删除；旧数据保留备份。

## 2. 参与者与身份

| 面 | 当前 0.2 |
| --- | --- |
| 身份 | 每个发送/接收者一个 identity，名字唯一 |
| 管理身份 | `manager=true`，可管理身份、目标、订阅 |
| 根控制者 | `owner`/`controller`，由 `controller-token` 文件维持 |
| 普通身份 | 可发送；不能改订阅、不能领取其他身份消息 |
| 凭据 | 随机 token，只在创建/轮换时返回一次；数据库只存 SHA-256 hash |
| 身份操作 | create/list/rotate/enable/disable |
| 团队角色 | 无。没有 owner/member/admin 之类的业务角色，只有 manager 这个配置权限 |
| 多租户 | 无。一个中心一套身份/目标/订阅 |

## 3. 入站传输

| 传输 | 当前能力 | 边界 |
| --- | --- | --- |
| HTTP | `POST /api/messages`、管理接口、`GET /api/messages/:id`、`GET /api/status`、`/health` | Bearer token；默认只监听 127.0.0.1；无内置 TLS |
| IPC | Unix socket `dataDir/notifs.sock`，4 字节长度前缀 JSON 帧 | 权限 600；同用户；只暴露发布/管理，不暴露内部领取 |
| MCP | stdio；`notifs mcp`；可用 `--socket` | 只提供工具，不提供上下文注入 |
| CLI | `notifs ...`；可 `--server` 或 `--socket` | 人的 controller token 默认生效 |
| 飞书入站 | 独立 `notifs-feishu-inbound` bridge，长连接或 HTTP 回调 | 当前生产返程已关闭；文本/post/附件占位；单实例锁 |
| 其他平台入站 | 无 | Discord、Windows 等未实现 |

### HTTP 路由

- `POST /api/authenticate`
- `POST /api/messages`
- `GET /api/messages/:id`
- `POST|GET /api/identities`
- `POST /api/identities/rotate`
- `POST /api/identities/enable`
- `PUT|GET /api/endpoints`
- `POST /api/endpoints/resume`
- `PUT|GET /api/subscriptions`
- `DELETE /api/subscriptions/:name`
- `POST /api/maintenance/prune`
- `GET /api/status`
- `GET /health`

内部 `delivery.claim/ack/renew` 不向 HTTP 或 IPC 客户端开放；由中心自己的 adapter 循环调用。

### IPC 边界

- 同一个身份、订阅、队列、幂等、投递语义。
- 不绕过认证：连接先 `authenticate`，之后不能换身份。
- 帧上限 1 MiB；请求并发上限 32/连接；超过拒绝。
- 不适合跨机器；跨机器用 HTTP。

## 4. 消息模型

| 面 | 当前 0.2 |
| --- | --- |
| 正文 | `{type, content}`；`type` 1–200 字符；`content` 任意 JSON |
| 来源 | 由 token 认证决定，消息不能自报 source |
| 系统字段 | `id`、`source`、`received_at` 由中心生成 |
| 目标 | 可选 `to`，只缩小订阅匹配结果，不能绕过订阅 |
| 回复/线程 | 无核心字段；需要时放在 `content` |
| 任务/会话/因果 | 不是核心概念 |
| 单条大小 | 260,000 字节；HTTP body 上限 1 MiB |
| 幂等 | 发送方提供稳定 client id；同一 source+id 重试返回原消息；内容/目标不同返回 409 |
| 去重 | 不按正文自动去重。相同正文可重复发送；重复责任在发送方 id |

## 5. 订阅与路由

| 面 | 当前 0.2 |
| --- | --- |
| 订阅对象 | `name + endpoint + source + type + all + enabled` |
| source/type | glob，`*` 通配 |
| 条件 | `eq/ne/in/exists/gt/lt`，按 content 路径 |
| `to` | 只缩小匹配范围 |
| 匹配 | 一个 endpoint 多条订阅命中只投一份 |
| 配置权限 | 仅 manager；普通身份不能改 |
| 变更影响 | 只影响后续消息；已排队消息保留原目标 |
| 旧版 rule/action | 已移除；现在没有独立 action 列表、优先级或 exclusive |

## 6. 接收目标与 adapter

目标 = `owner identity + delivery kind/config + 批处理参数`。

| kind | 用途 | 备注 |
| --- | --- | --- |
| `webhook` | 程序接收完整批次 JSON | 2xx 表示接管；有 `Idempotency-Key` |
| `opencode` | agent 宿主输入 | 调 `/api/session/{id}/synthetic`，非 user_prompt；批次变成一个 `<agent-messages>` 块 |
| `local` | Linux 桌面/终端 | `notify-send`，失败退回 stdout |
| `feishu` | 飞书群自定义机器人 webhook | 文本/post，可加签、@ |
| `feishu-app` | 飞书应用机器人 | tenant token；群/单聊；文本/post；文本截断 18k |
| `ntfy` | ntfy 推送 | 代码存在 |
| `bark` | iOS Bark | 代码存在 |
| `wecom` | 企业微信机器人 | markdown/text |

没有 Discord、Windows 桌面、移动端原生客户端。

## 7. 投递生命周期

- **队列持久化**：消息和每个目标的 delivery 在同一事务落库。
- **主动推送**：中心自己 claim、调用 adapter、ack；接收方不需要领取。
- **批次**：每个 endpoint 同时只有一个 active batch；`max_wait_ms`、`max_messages`、`max_bytes` 控制。
- **限频**：`min_interval_ms` 跨批生效。
- **暂停**：`paused` 保留队列但不交付。
- **租约**：默认 30 秒；adapter 每 10 秒续租；过期可重发同一批。
- **重试**：adapter 返回可重试错误则保留；默认最多 20 次，之后 `held`。
- **恢复**：`endpoint resume` 把 held 批次放回。
- **容量**：默认 100,000 个待投递责任、512 MiB 存储；超过拒绝新发布，不丢已有队列。
- **保留**：默认 30 天清理完全接管且过期的消息；pending/leased/held 不清理。
- **语义**：至少一次交付；接收方必须按消息 ID/幂等键去重；ack 只表示接管，不代表人已读或任务完成。

## 8. 管理面

### CLI

`init`、`start`、`mcp`、`service install/uninstall`、`backup/restore`；`identity add/list/rotate/enable/disable`；`endpoint put/list/resume`；`subscription put/list/rm`；`message send/inspect/status`。

### MCP 工具（当前 0.2）

所有身份：

- `send`：`type + content + to?`
- `inspect`：按消息 ID 查自己发送/收到的投递状态

管理身份额外：

- 身份：`create_identity`、`list_identities`、`rotate_identity`、`set_identity_enabled`
- 目标：`set_endpoint`、`list_endpoints`、`resume_endpoint`
- 订阅：`set_subscription`、`list_subscriptions`、`remove_subscription`

当前 MCP **没有**：`ask`、`events`、`deliveries`、`status`、watcher/producer 管理、prompts、resources。

### 状态与观测

- `/api/status`：revision、pending、stored_bytes、按 endpoint/state 的队列计数。
- `message inspect`：单条消息内容、来源、投递 endpoint/state。
- 日志：pino/JSON 或 systemd journal。
- 没有事件流列表、投递列表/重试命令、Web UI、指标端点。

## 9. 运行时与运维

| 面 | 当前 0.2 |
| --- | --- |
| 进程 | CLI `start` 启动 server；server 内 worker thread 持有 SQLite 写权 |
| 存储 | SQLite WAL，foreign_keys，synchronous=FULL，busy_timeout=5s，schema v1 |
| 默认地址 | `127.0.0.1:7710`；生产 relay 当前用 `127.0.0.1:7802` |
| 配置 | `NOTIFS_CONFIG_DIR/DATA_DIR/DB/SOCKET/HOST/PORT/BASE_URL/LOG_LEVEL/RETENTION_DAYS/CLEANUP_INTERVAL_MS` |
| systemd | `service install [--name]` 写用户 unit；支持 `EnvironmentFile=-configDir/env` |
| 备份 | `backup` 在线 SQLite 快照；`restore --force` 停服务后覆盖 |
| 健康 | `/health` |
| 迁移 | 不导入旧 notifs 历史；旧 DB 直接拒绝；重建身份/目标/订阅 |

## 10. 安全边界

- 身份 token 数据库只存 hash；controller token 文件 600。
- IPC socket 600，仅同用户；HTTP 默认 localhost。
- 平台凭据从进程环境解析（`resolveSecret`），不落 adapter 配置；0.2 **没有**旧版的加密 secret store。
- HTTP 无内置 TLS、无反向代理、无限流；远程暴露必须自己加 TLS/访问控制。
- webhook 目标 URL 未做 SSRF allowlist；自托管场景由部署者负责。
- 没有审计日志、RBAC、多租户隔离、消息加密存储。
- 管理权限只有 manager/普通身份两级；没有细粒度授权。

## 11. agent 宿主边界

- **中心 → agent**：宿主 adapter 调自己的非 user_prompt 接口；OpenCode 用 synthetic。中心不伪装成用户提示词。
- **agent → 中心**：agent 自己用 MCP `send`、HTTP POST 或 IPC 发送；中心不解析最终文本/reasoning/日志。
- 当前只保留 OpenCode 作为已有输入 adapter 的示例；没有继续开发 OpenCode 专用回复桥。
- 其他 agent 宿主需要实现自己的输入 adapter；输出侧统一走 MCP/POST/IPC。
- 宿主 prompt/工具权限属于宿主，不属于中心。agent 需要提问时发送 `type=question`，普通回复发送 `type=reply`。

## 12. 旧版能力：已移除但必须知道

旧版 notifs 1.x 是另一套模型：

| 面 | 旧版 | 0.2 |
| --- | --- | --- |
| 入站 API | `/api/v1/events`、`/api/v1/ask` | `/api/messages` |
| 配置模型 | source / channel / rule | identity / endpoint / subscription |
| 规则 | `when` + `actions` + priority + exclusive | 订阅匹配 + 条件 |
| `ask` | 发消息并等待引用回复，返回原话；pending/answered/expired | 未移植。现在只有 `question`/`reply` 消息，无内建等待/关联 |
| 去重 | 按 dedup_key/源+type+text TTL 24h | 按 source+client id 幂等，无正文去重 |
| 事件/投递查询 | `events`、`deliveries`、`deliveries retry` | `inspect`、`status`；无列表/重试命令 |
| MCP 工具 | `send`、`ask`、`events`、`deliveries`、`status` | `send`、`inspect` + 管理工具 |
| MCP prompts/resources | `write-script`、`write-monitor`、`poller`、`notifs://contract` | 无 |
| 托管程序 | managed/poller producer；自动启动、30s 心跳、崩溃退避、日志、凭据注入 | 无。程序/agent 自己负责常驻与重试 |
| poller | 声明式 HTTP 轮询、字段变化/阈值 | 无 |
| 凭据存储 | AES-GCM secret store | 进程环境；无 secret store |
| 备份 | DB + 主密钥 | DB 在线备份；无主密钥（不加密） |
| 旧 producer | `feishu-events`、`routine`、`pr-replies` 等 | 不再有 producer 框架；旧服务/包已删除 |

旧版的这些能力不是“忘了提”，而是 0.2 明确移除了；如果还需要托管程序、poller、ask、events/deliveries 列表或 secret store，需要重新设计并实现，不能假设它们还在。

## 13. 明确不在当前边界

- 业务角色、任务、项目、会话、回复线程、因果链。
- 独立发送权限规则、细粒度审批。
- 多节点、HA、SaaS、多租户、Web UI、移动端。
- 公网入口/TLS/内置反向代理。
- Discord、Windows 桌面。
- 旧 notifs 历史导入、旧 producer 兼容层。
- 表单/权限 adapter、文本回复桥。
- MCP prompts/resources 和托管程序管理。

## 14. 当前生产拓扑

- relay：`notifs-0.2.service`，`127.0.0.1:7802`，只做出站；飞书入站 bridge 未启用。
- 旧 relay `notifs.service`、旧全局包、旧 `feishu-events` 已删除/停止；旧数据备份 `/root/notifs-old-backup-20261111.tgz`。
- 本机：`notifs-0.2-tunnel.service` 把本机 7802 转发到 relay；OpenCode 通过 MCP `send` 发到 relay 中心，再到飞书。
- 本机旧全局 `notifs` 包和全局 OpenCode `notifs` MCP 配置仍存在，但生产会话使用独立的新包/新配置；旧全局 MCP 已不再指向可用中心，不能当作生产入口。
- 返程（飞书 → OpenCode）未配置。
- 72 小时观察仍未结束。
