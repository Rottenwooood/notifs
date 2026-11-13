# 配置：身份、接收目标、订阅

## 管理与发送

`notifs init` 创建 `owner`；人的 CLI 默认使用配置目录的 `controller-token`。`identity add <name>` 创建普通身份，加 `--manager` 允许管理身份、目标与订阅。每个身份只用一个 token；无独立发送权限规则，也无内置团队角色。

发送进程配置 `NOTIFS_BASE_URL` 和 `NOTIFS_TOKEN`；同一台机器上也可以只配置 token 并走 Unix socket：CLI 加 `--socket <路径>`，MCP 用 `notifs mcp --socket <路径>`。socket 默认在数据目录的 `notifs.sock`，权限 600；IPC 和 HTTP 共用身份、订阅、队列、幂等和投递语义。程序或入站 adapter 使用自己的身份向 `/api/messages` 或 IPC 发布 `{type,content}`，agent 可经 MCP `send`。身份轮换用 `identity rotate`，停用用 `identity disable`。聊天平台入站当前由独立的飞书 bridge 发布 `human.message`；Discord 等尚未实现。人也可以经 CLI、HTTP 或使用方自己的入站桥接发布。

可选 `Idempotency-Key` 用于同一次发送的安全重试，CLI 对应 `--id`。客户端自动重试复用同一标识；相同标识不同内容返回 409。无匹配订阅返回 `422 unrouted`。

## 接收目标：明确配置主动交付

管理者通过 CLI `endpoint put --config '<json>'` 或 MCP `set_endpoint` 设置：

```json
{"name":"build-service","owner":"worker","delivery":{"kind":"webhook","config":{"url":"http://host/messages"}}}
```

`name` 标识目标，`owner` 指定身份，`delivery` 必填；没有默认领取模式。同一个身份可拥有多个目标。通知渠道、程序回调和 agent 会话都只是不同的适配器配置。

| kind | config | 中心执行 |
| --- | --- | --- |
| webhook | `{"url":"http://host/messages","headers":{}}` | POST 完整批次；2xx 接管 |
| opencode | `{"url":"http://127.0.0.1:4096","session":"ses_...","headers_env":"OPENCODE_HEADERS","delivery":"steer"}` | 调用 OpenCode 2.x `/api/session/{session}/synthetic` 写入 synthetic 输入；一组合并为 `<agent-messages>` 非用户提示块，默认 steer 并继续运行 |
| local | `{}` 或 `{"logOnly":true}` | Linux notify-send 或日志 |
| feishu | `{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/..."}` | 飞书群机器人 |
| feishu-app | `{"receiveId":"oc_...","receiveIdType":"chat_id"}` | 飞书应用；服务环境提供 FEISHU_APP_ID / FEISHU_APP_SECRET |
| ntfy | `{"topic":"topic","server":"https://ntfy.sh"}` | ntfy |
| bark | `{"key":"..."}` | Bark |
| wecom | `{"webhookKey":"..."}` | 企业微信机器人 |

OpenCode session 由宿主预先创建并选择模型、权限和工作目录。`headers_env` 指向 **notifs 服务环境**中的 headers JSON（例如 Basic Authorization），不要提交凭据；也支持私有配置 `headers`。`delivery` 取 `steer` 或 `queue`，默认 `steer`；`resume:false` 只存入宿主输入队列，等待宿主调度。adapter 用批次派生的稳定宿主消息 ID 重试，不创建新会话。消息以 synthetic 输入写入，正文是标记为不可信数据的 `<agent-messages>` 块，不是用户提示词。该适配器不代表其他 agent 宿主已经接通。

webhook 格式为 `{id,endpoint,messages:[{id,source,type,content,received_at}]}`，Idempotency-Key 为批次 ID；接收程序持久保存、去重后返回 2xx。外部 adapter 可在本机或接收方网络运行 webhook 桥接。云端中心必须能访问回调地址；没有公网地址的本机接收方需要可达网络或桥接，当前未提供反向连接代理。

## agent 宿主的两个边界

agent 接入分两个方向，不能用解析模型最终文本代替协议：

- **中心 → agent**：由宿主 adapter 调用该宿主的非 user_prompt 输入接口。`opencode` 的现有实现调用 `/api/session/{id}/synthetic`，写入 synthetic 输入，不是用户提示词。
- **agent → 中心**：agent 必须用 notifs 身份调用 MCP `send`，或直接 `POST /api/messages`，正文是 `{type,content}`。中心不读取、不解析模型的最终文本；没有文本回复桥。

MCP 配置示例（agent 身份）：

```json
{
  "mcp": {
    "notifs": {
      "type": "local",
      "command": ["notifs", "mcp"],
      "environment": {
        "NOTIFS_BASE_URL": "http://127.0.0.1:7710",
        "NOTIFS_TOKEN": "{file:/path/to/agent-token}"
      }
    }
  }
}
```

agent 发回时使用 `type=reply` 或 `type=question`，再由订阅路由到人类目标。宿主要求 agent 在需要人回答时发送 `question` 并结束本轮，不要停在本地表单或等待状态。

adapter 决定最终表现：程序保留 JSON，agent 转为宿主输入，通知渠道生成文本/卡片。核心不规定通知标题或 agent 会话字段。Discord、Windows 桌面暂未实现。

## 订阅与交付

```json
{"name":"failures","source":"test-runner","type":"test.failed","endpoint":"build-service"}
```

管理者用 CLI `subscription put --config '<json>'` 或 MCP `set_subscription` 编辑。source/type 支持 `*`，省略匹配全部；`all` 可筛 content，如 `[{"field":"result.failed","op":"gt","value":0}]`。匹配后由中心主动交付，接收方无需领取。

`to` 只缩小匹配范围：MCP 用 `to` 参数，CLI 用 `--to a,b`，HTTP 用 `X-Notifs-To: a,b` 请求头，不能放进消息正文。同目标多条规则命中只投一份。订阅变更影响未来消息，已接受消息保留原目标。目标可设置 `max_wait_ms`、`min_interval_ms`、`max_messages`、`max_bytes`；`paused:true` 保留排队项并暂停交付。重试耗尽为 held，CLI `endpoint resume` 或 MCP `resume_endpoint` 恢复。确认仅表示适配器/宿主接管，不表示任务完成。

## 服务

`NOTIFS_DATA_DIR`、`NOTIFS_CONFIG_DIR`、`NOTIFS_DB`、`NOTIFS_HOST`、`NOTIFS_PORT`、`NOTIFS_BASE_URL`、`NOTIFS_SOCKET`、`NOTIFS_LOG_LEVEL`（默认 `info`）。默认 `127.0.0.1:7710`；数据目录 `hub.db` 与 `notifs.sock`。远程服务需配置可达地址，生产公网访问应使用 HTTPS 入口。

`NOTIFS_RETENTION_DAYS` 默认 `30`，只清理已经完全接管且早于期限的消息；待投递、租约中、held 的消息不会被删除。设为 `0` 关闭自动清理。`NOTIFS_CLEANUP_INTERVAL_MS` 默认一小时，最低一分钟。

常驻部署：

```sh
notifs service install          # 写 ~/.config/systemd/user/notifs.service
notifs service install --print  # 只打印 unit
systemctl --user daemon-reload
systemctl --user enable --now notifs
```

`notifs service install` 只写 unit，不自动启用；unit 固定使用当前 Node 和构建后的 `cli.mjs`。服务日志用 `journalctl --user -u notifs -f`。

备份与恢复：

```sh
notifs backup /backup/notifs-$(date +%F).db   # 在线 SQLite 备份，目标不能已存在
systemctl --user stop notifs                  # 恢复前必须停服务
notifs restore /backup/notifs-2026-11-10.db --force
systemctl --user start notifs
```

恢复会覆盖当前数据库并移除对应 `-wal`/`-shm`；旧库不会被自动删除。

旧通知数据库拒绝直接打开，原文件保留；凭据不回退读取旧 token/admin-token。已有 pull 目标需通过管理入口重新配置为明确的适配器，不保留旧领取入口。


## 人类入站：飞书

真实飞书入站使用**长连接**：bridge 用应用凭据主动连接飞书事件通道，不需要公网 IP、域名或本地飞书客户端。飞书应用后台开启事件订阅，订阅 `im.message.receive_v1`，并授予接收消息权限。

```sh
FEISHU_APP_ID=... \
FEISHU_APP_SECRET=... \
NOTIFS_BASE_URL=http://127.0.0.1:7710 \
NOTIFS_TOKEN=<人类身份 token> \
notifs-feishu-inbound
```

- 默认连接飞书；`FEISHU_DOMAIN=lark` 时连接 Lark。
- 收到用户消息后忽略机器人消息，按 `event_id` 幂等，发布 `human.message`。默认只转发“引用了某条消息”或“@ 了机器人”的消息，避免群聊噪音；设 `FEISHU_ONLY_RELEVANT=false` 才接收全部消息。
- 内容包含文本、open_id/user_id、chat_id、message_id；订阅把它路由给 agent 或程序。
- 长连接断线由 SDK 自动重连。

长连接模式下，同一个飞书应用同时只能有一个客户端收事件；如果旧架构的 `feishu-events` producer 仍在运行，必须先停用它，否则新旧客户端会随机抢事件。bridge 默认在 `${XDG_RUNTIME_DIR:-/tmp}/notifs-feishu-<app-id-hash>.lock` 取得单实例锁；第二个实例会直接失败，不会静默抢事件。可用 `FEISHU_LOCK_FILE` 指定锁路径。

如果飞书只能走 HTTP 事件回调，可以不配 `FEISHU_APP_ID/SECRET`，改配 `FEISHU_VERIFICATION_TOKEN`；bridge 会监听 `FEISHU_INBOUND_PORT`（默认 `7720`）的 `FEISHU_INBOUND_PATH`（默认 `/feishu/events`），由飞书主动 POST。这种方式要求回调地址能被飞书访问，并自行处理网络暴露。

出站的飞书通知仍由 `feishu` 或 `feishu-app` 目标发送，与入站是不同方向。
