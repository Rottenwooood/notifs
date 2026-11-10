# 配置：身份、接收目标、订阅

## 管理与发送

`notifs init` 创建 `owner`；人的 CLI 默认使用配置目录的 `controller-token`。`identity add <name>` 创建普通身份，加 `--manager` 允许管理身份、目标与订阅。每个身份只用一个 token；无独立发送权限规则，也无内置团队角色。

发送进程配置 `NOTIFS_BASE_URL` 和 `NOTIFS_TOKEN`；本地可用 `--socket <路径>`。程序或入站 adapter 使用自己的身份向 `/api/messages` 发布 `{type,content}`，agent 可经 MCP `send`。身份轮换用 `identity rotate`，停用用 `identity disable`。现有聊天平台适配器只负责出站通知，尚未实现飞书/Discord 等平台消息入站；人当前通过 CLI、HTTP 或使用方提供的入站桥接发布。

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
| opencode | `{"url":"http://127.0.0.1:4096","session":"ses_...","headers_env":"OPENCODE_HEADERS"}` | 调用 OpenCode 2.x `/api/session/{session}/prompt` 写入输入，默认继续运行 |
| local | `{}` 或 `{"logOnly":true}` | Linux notify-send 或日志 |
| feishu | `{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/..."}` | 飞书群机器人 |
| feishu-app | `{"receiveId":"oc_...","receiveIdType":"chat_id"}` | 飞书应用；服务环境提供 FEISHU_APP_ID / FEISHU_APP_SECRET |
| ntfy | `{"topic":"topic","server":"https://ntfy.sh"}` | ntfy |
| bark | `{"key":"..."}` | Bark |
| wecom | `{"webhookKey":"..."}` | 企业微信机器人 |

OpenCode session 由宿主预先创建并选择模型、权限和工作目录。`headers_env` 指向 **notifs 服务环境**中的 headers JSON（例如 Basic Authorization），不要提交凭据；也支持私有配置 `headers`。`resume:false` 只存入宿主输入队列，等待宿主调度。adapter 用批次派生的稳定宿主消息 ID 重试，不创建新会话。该适配器不代表其他 agent 宿主已经接通。

webhook 格式为 `{id,endpoint,messages:[{id,source,type,content,received_at}]}`，Idempotency-Key 为批次 ID；接收程序持久保存、去重后返回 2xx。外部 adapter 可在本机或接收方网络运行 webhook 桥接。云端中心必须能访问回调地址；没有公网地址的本机接收方需要可达网络或桥接，当前未提供反向连接代理。

adapter 决定最终表现：程序保留 JSON，agent 转为宿主输入，通知渠道生成文本/卡片。核心不规定通知标题或 agent 会话字段。Discord、Windows 桌面暂未实现。

## 订阅与交付

```json
{"name":"failures","source":"test-runner","type":"test.failed","endpoint":"build-service"}
```

管理者用 CLI `subscription put --config '<json>'` 或 MCP `set_subscription` 编辑。source/type 支持 `*`，省略匹配全部；`all` 可筛 content，如 `[{"field":"result.failed","op":"gt","value":0}]`。匹配后由中心主动交付，接收方无需领取。

`to` 只缩小匹配范围：MCP 用 `to` 参数，CLI 用 `--to a,b`，HTTP 用 `X-Notifs-To: a,b` 请求头，不能放进消息正文。同目标多条规则命中只投一份。订阅变更影响未来消息，已接受消息保留原目标。目标可设置 `max_wait_ms`、`min_interval_ms`、`max_messages`、`max_bytes`；`paused:true` 保留排队项并暂停交付。重试耗尽为 held，CLI `endpoint resume` 或 MCP `resume_endpoint` 恢复。确认仅表示适配器/宿主接管，不表示任务完成。

## 服务

`NOTIFS_DATA_DIR`、`NOTIFS_CONFIG_DIR`、`NOTIFS_DB`、`NOTIFS_HOST`、`NOTIFS_PORT`、`NOTIFS_BASE_URL`、`NOTIFS_SOCKET`。默认 `127.0.0.1:7710`；数据目录 `hub.db` 与 `notifs.sock`。远程服务需配置可达地址，生产公网访问应使用 HTTPS 入口。

旧通知数据库拒绝直接打开，原文件保留；凭据不回退读取旧 token/admin-token。已有 pull 目标需通过管理入口重新配置为明确的适配器，不保留旧领取入口。
