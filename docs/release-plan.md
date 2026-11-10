# notifs v0.2.0 发布路线

## 1. 发布目标

`v0.2.0` 是一个**单节点、自托管**的订阅通信中心：

- 人、程序、agent 用身份 token 发布 `type + content`。
- 中心按订阅主动推送到接收目标。
- 人类渠道负责渲染；agent 宿主负责把消息注入会话，agent 自己把回复发回中心。
- 支持本机或服务器部署；不提供多节点、HA、SaaS 控制台。

发布包含两条独立验收线：

1. **产品发布**：其他人可以按文档安装、配置、升级、卸载，并完成自己的闭环。
2. **生产切换**：把当前 relay 上的旧 notifs 和同一个飞书 bot 切到新中心，且能回滚。

## 2. 两个不可违反的边界

### 2.1 中心 → agent 必须是非 user_prompt

中心不把消息伪装成用户提示词。每个 agent 宿主 adapter 调用该宿主的非 user_prompt 输入接口：

- OpenCode：`POST /api/session/{id}/synthetic`，`type=synthetic`。
- 其他宿主：由对应 adapter 调用其 system/developer/event 输入接口。

中心只负责投递批次；具体注入方式由 adapter 决定。

### 2.2 agent → 中心必须是显式发送

agent 必须用自己的 notifs 身份：

- 调用 notifs MCP `send`；或
- 直接 `POST /api/messages`，正文 `{type,content}`。

中心**不解析** agent 的最终文本、reasoning、日志或工具输出。没有“回复桥”读取模型回答再代发。agent 需要提问时发送 `type=question`，需要回复时发送 `type=reply`，然后结束本轮。

宿主侧的 system prompt 和工具权限由宿主自己配置；notifs 只提供 MCP/HTTP 接口和身份 token。

## 3. 当前基线

已完成：

- adapter 统一为批次交付契约；人类渠道在 adapter 边缘渲染。
- 飞书长连接入站、HTTP 回调回退、事件去重和相关消息过滤。
- OpenCode `/api/session/{id}/synthetic` 注入；真实模型已验证。
- 中心→agent 的非 user_prompt 路径已验证。
- agent→中心已有 MCP `send` 和 HTTP POST。
- `pnpm typecheck`、测试、`pnpm build` 通过。

已废弃：

- `notifs-opencode-host` 及任何解析模型最终文本的回复桥。它们违反 2.2，不作为发布物。

仍未完成：

- agent 宿主必须自己调用 MCP/POST；当前文档和示例还需要按新契约整理。
- 新中心没有正式安装、升级、备份、保留清理和旧数据迁移流程。
- 飞书 bridge 没有单实例锁；同一应用双客户端会抢事件。
- 新中心尚未部署到生产；旧 `feishu-events` 仍在生产运行。
- 没有正式 CI、npm 包验收和 72 小时观察。

## 4. 部署形态

| 形态 | 组成 | 适用 |
| --- | --- | --- |
| A 全本地 | 中心 + 飞书 bridge + agent 宿主在同一台机器 | 个人、开发机、单机自托管 |
| B 中心常驻 | 中心 + 飞书 bridge 在服务器；agent 宿主在工作站；agent 通过中心可达地址发送 MCP/POST | 需要 7×24 在线，agent 在本地 |

形态 B 不要求中心反向调用 agent；中心只通过对应的非 user_prompt adapter 推送。若该 adapter 需要访问本地宿主，使用 SSH 反向隧道或私有网络，属于部署配置，不是核心功能。

不正式支持：多节点、HA、SaaS、Web UI、移动端、云端直接访问 NAT 后本机且没有隧道。

## 5. 数据迁移

新中心不导入旧 notifs 历史。旧数据库保留只读。

切换时重新创建：

- 身份和 token
- 接收目标
- 订阅
- 飞书应用凭据
- agent 会话和宿主 adapter 配置

旧消息、旧投递记录不迁移；需要保留时单独归档。

## 6. 完整阶段

| 阶段 | 内容 | 预计 | 门禁 |
| --- | --- | --- | --- |
| P0 | 发布范围冻结 | 0.5–1 天 | 两个边界、支持矩阵、非目标定稿 |
| P1 | agent 接入契约 | 1–2 天 | 非 user_prompt 入站；MCP/POST 出站；无文本解析 |
| P2 | MCP 与发送接口硬化 | 2–3 天 | 身份、幂等、错误、示例、集成测试 |
| P3 | 核心可靠性与安全 | 4–6 天 | 崩溃恢复、备份、保留清理、安全清单 |
| P4 | 飞书生产化 | 3–4 天 | 单实例锁、重连、去重、限流、真实双端 |
| P5 | 打包、安装、迁移 | 3–4 天 | 干净机器安装、升级、卸载、迁移文档 |
| P6 | 完整验收矩阵 | 3–5 天 | 所有 P0/P1 场景通过，无阻塞缺陷 |
| P7 | RC 与正式发布 | 2–3 天 | npm 包、CI、变更日志、标签、发布说明 |
| P8 | 生产切换与观察 | 1–2 天 + 72 小时 | 切换、回滚、72 小时观察通过 |

## 7. 各阶段任务

### P0 发布范围冻结

- 固定版本号 `0.2.0`。
- 固定 v0.2.0 支持矩阵：
  - Linux + systemd；Node 20/22。
  - 飞书应用机器人，文本消息。
  - agent 接入：MCP `send` 或 HTTP POST；宿主非 user_prompt 输入由 adapter 实现。
  - 出站：webhook、local、ntfy、Bark、WeCom、feishu、feishu-app。
  - 入站：飞书长连接；HTTP 回调作为回退。
- 明确不做：Discord、Windows 桌面、HA、多节点、Web UI、移动端、SaaS、旧历史导入、文本回复桥。
- 产出：本文件定稿 + README 支持范围 + 版本策略。

### P1 agent 接入契约

- 把 `integrations/agent` 定义为唯一 agent 接入说明，不再提供 OpenCode 专用回复桥。
- 说明宿主必须满足：
  - 入站使用非 user_prompt 接口。
  - 出站由 agent 自己调用 MCP `send` 或 POST。
  - 宿主 prompt 要求 agent 提问/回复后结束本轮，不停在本地 form。
- 提供 MCP 配置示例和 HTTP POST 示例。
- 验证：
  - agent 通过 MCP 发送 `question`，人类收到。
  - 人回复后，agent 通过 MCP 发送 `reply`。
  - 中心不读取模型最终文本。
- 不新增 form/permission adapter。

### P2 MCP 与发送接口硬化

- MCP：
  - `send`、`inspect`、管理工具的参数校验。
  - 身份 token 从环境/文件读取；不写进配置。
  - 发送失败的错误可读；重试复用稳定 ID。
  - MCP 进程断开后不拖垮中心。
- HTTP：
  - `POST /api/messages` 的身份、idempotency-key、`X-Notifs-To`、错误码。
  - 明确 body 大小和超限行为。
- 测试：
  - MCP `send` 到订阅目标。
  - HTTP POST 到订阅目标。
  - 同一 idempotency key 重试不重复。
  - 无匹配订阅返回 422。
- 产出：`docs/agent-integration.md` 或等价文档、MCP 集成测试。

### P3 核心可靠性与安全

- 数据库：
  - schema 版本与迁移入口。
  - WAL、busy timeout、完整性检查。
  - 历史保留与清理策略：已投递消息、held 批次、数据库上限。
  - 备份与恢复脚本；恢复后能继续投递。
- 投递：
  - 租约续期、重试、held、resume 的完整状态可见。
  - 进程 SIGKILL 后重启，待投递和已投递状态正确。
  - 容量不足拒绝新提交，不丢已接收消息。
  - 同一批次重复投递的幂等边界写清楚。
- 安全：
  - 身份 token 存储、轮换、停用、越权测试。
  - controller token 权限边界。
  - 凭据只经环境/600 文件；日志、错误、状态接口不回显。
  - 默认只绑定 `127.0.0.1`；远程部署要求 TLS 反向代理。
  - webhook 目标校验和 SSRF 风险说明。
  - 依赖审计。
- 产出：可靠性/安全验收记录。

### P4 飞书生产化

- 入站：
  - 单实例锁：同一应用第二个 bridge 启动必须失败。
  - 长连接断线重连、事件去重、`onlyRelevant`、群聊/单聊、@ 识别。
  - 文本消息完整处理；非文本消息明确忽略并记录。
  - 旧 `feishu-events` 切换步骤和检查项。
- 出站：
  - `tenant_access_token` 缓存与刷新。
  - 文本长度限制、限流、429/5xx 重试、权限错误不可重试。
  - 返回飞书 message id，投递状态可追踪。
- 验证：同一 bot 双向、重复事件、断线重连、旧 producer 停启、长文本、限流。
- 产出：飞书部署与故障排查文档。

### P5 打包、安装、迁移

- npm 包：
  - `notifs`、`notifs-feishu-inbound` 两个 bin。
  - `better-sqlite3` 原生依赖的安装说明和 Node 版本矩阵。
  - `npm pack` 后在干净目录安装并跑通。
- 初始化：
  - `notifs init` 创建配置/数据目录、controller token、默认身份。
  - `notifs start` 前台启动。
  - `notifs service install` 或等价脚本生成 systemd 用户服务。
- 文档：
  - 安装、升级、卸载、备份、恢复、日志、端口、权限。
  - 全本地和中心常驻两种部署。
  - 从旧 notifs 切换：不导历史、重建身份/目标/订阅、停旧 producer、回滚。
- 验证：干净机器安装、alpha 升级、卸载不删用户数据、迁移演练。
- 产出：可发布包和迁移手册。

### P6 完整验收矩阵

必须使用构建产物，不用源码内调用代替外部操作。

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| A1 | 人 → 飞书 bot → 中心 → agent 宿主非 user_prompt 输入 | 入站、宿主输入、投递均有 ID |
| A2 | agent 通过 MCP 发送 question → 飞书 | 人类收到；中心无文本解析 |
| A3 | 人回复 → agent 通过 MCP 发送 reply → 飞书 | 同 bot 回原会话；投递 received |
| A4 | 一轮多条消息合并 | 一个限频窗口只产生一个宿主输入批次 |
| A5 | HTTP POST 发送与 idempotency-key 重试 | 不重复；冲突返回 409 |
| A6 | 飞书重复事件 | 只发布一次 human.message |
| A7 | 投递中 SIGKILL 中心 | 重启后继续，不丢已接收消息 |
| A8 | 飞书 bridge 断线重连/双实例 | 自动恢复；第二实例被拒 |
| A9 | 身份 token 轮换/停用/越权 | 旧 token 失效；未授权被拒 |
| A10 | 容量不足 | 拒绝新提交；已有队列不丢 |
| A11 | 备份恢复 | 恢复后可继续投递，历史可查 |
| A12 | 24 小时浸泡 | 无泄漏、无重复、无未解释 held |

A1/A2/A3/A7/A8/A11 为发布阻塞项。

### P7 RC 与正式发布

- 版本改为 `0.2.0`；CHANGELOG 写清破坏性变化和不兼容项。
- CI：Node 20/22 上 typecheck、test、build、`npm pack` 冒烟。
- 依赖审计；license；包内容检查，确保不含测试数据、凭据、临时文件。
- 打 `v0.2.0` tag，发布 npm 包和 GitHub Release。
- 发布说明包含：
  - 支持范围和不支持项。
  - 安装命令。
  - 飞书应用权限和长连接配置。
  - agent MCP/POST 接入和宿主非 user_prompt 要求。
  - 旧 notifs 切换与回滚。
- 门禁：RC 验收全过；无已知 P0 缺陷；发布包可在干净机器安装。

### P8 生产切换与观察

本轮采用 A 形态（全本地）并在 2026-11-10 完成切换；72 小时观察进行中。详见 [阶段 7 验收](validation/stage-7.md)。

切换前：

1. 列出旧 notifs 的全部 producer、rule、channel、token。
2. 决定每个 producer 是迁移、停用还是保留旧服务。
3. 备份旧数据库、配置、飞书凭据状态。
4. 准备新中心配置、身份、目标、订阅。
5. 准备回滚命令。

切换窗口：

1. 停旧 `feishu-events`，确认没有旧客户端持有长连接。
2. 启动新中心 + 新 bridge，确认 `ws client ready`。
3. 跑 A1/A2/A3 真实闭环。
4. 观察投递、错误、held。
5. 旧服务保持安装但入站 producer 停用。

回滚：

1. 停新 bridge。
2. 重新启用旧 `feishu-events`。
3. 重启旧 notifs，确认旧 producer 恢复。
4. 新中心数据保留，不删除；后续可重试切换。

门禁：切换后 72 小时无重复投递、无消息丢失、无未解释 held；回滚演练至少一次。

## 8. 发布阻塞项

以下任一未完成，不得发布：

- 存在解析模型最终文本的回复桥，或中心把文本当消息。
- 中心→agent 使用 user_prompt 而不是宿主非 user_prompt 接口。
- agent 不能通过 MCP 或 HTTP POST 发回消息。
- 飞书 bridge 没有单实例锁，或断线不能自动恢复。
- 中心 SIGKILL 后会丢已接收消息。
- 没有备份/恢复和保留清理策略。
- 安装包不能在干净机器安装。
- 没有生产切换和回滚步骤。
- 发布包含凭据、测试数据或临时文件。

## 9. 明确不做

- 文本回复桥/最终文本解析。
- form/permission adapter。
- OpenCode 专用回复桥的后续开发。
- Discord、Windows 桌面。
- 多节点、HA、SaaS、Web UI、移动端。
- 旧 notifs 历史数据导入。
- 云端直接访问 NAT 后本机且没有隧道。

## 10. 下一步入口

1. 定稿本文件的支持矩阵和两个边界。
2. P1/P2 先整理 agent MCP/POST 接入和示例，跑 A2/A3。
3. P3/P4 并行；P5 依赖 P2/P3/P4 的稳定接口。
4. P6 全量验收后进 P7；P8 只在 RC 通过后执行。
