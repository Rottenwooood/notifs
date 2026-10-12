# 飞书事件（长连接）

用飞书**官方 SDK 的长连接**接收应用事件，转成 notify-hub 事件上报。

**为什么用长连接**：飞书服务器不必回调我们的公网地址——程序主动连出去。
所以在只有内网 / 本机、没有公网入口的部署下也能收到事件。

## 需要什么

| 项 | 从哪来 |
|---|---|
| App ID / App Secret | 飞书开放平台 → 你的应用 → 凭证与基础信息 |
| 订阅方式 | 开放平台 → 事件与回调 → **订阅方式选「长连接」** |
| 已添加事件 | 同上；默认用 `im.message.receive_v1`（接收消息） |

把两个凭据存进中心的加密密钥库（本程序通过 `credentials` 声明、中心运行时注入）：

```sh
pnpm cli secret set FEISHU_APP_ID --value 'cli_xxxxxxxxxxxxxxxx'
pnpm cli secret set FEISHU_APP_SECRET --value '<App Secret>'
```

然后在中心的「监控程序」页启用 `feishu-events`（或把本目录放进 `producers/` 后重启中心）。

## 配置

`producer.json` 的 `config`：

```json
{
  "events": ["im.message.receive_v1"],
  "ignoreAppSender": true
}
```

- `events`：要转发的事件类型列表，逐条注册到 SDK 的事件分发器；想加别的事件就加进来。
- `ignoreAppSender`：忽略机器人自己发出的消息。

## 事件 → 信封

- `type`：`feishu.<事件类型>`，例如 `feishu.im.message.receive_v1`
- `text`：消息正文（`text` 直取；`post` 富文本拼行；图片/文件等给占位说明）
- `dedup_key`：`feishu:<事件类型>:<event_id>`（飞书每次事件都有唯一 event_id）
- `data`：chat_id / chat_type / message_id / sender 等结构化信息，便于规则与模板取用

## 排障

- 中心「监控程序」页看本程序的日志与心跳；飞书开放平台那页有「验证连接状态」按钮，可用来交叉确认。
- 缺凭据 → 会以 error 心跳 + 明确文案退出（不无限重启）；存好凭据后在页面上重新启用即可。
- 连接被飞书断开 → SDK 自动重连，心跳状态会在 `degraded` 与 `ok` 之间如实反映。
