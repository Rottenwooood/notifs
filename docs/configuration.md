# 配置：身份、接收目标、订阅

## 人和 Last Order

`notifs init` 创建本地控制者 `owner`，凭据为配置目录的 `controller-token`。人的 CLI 默认读取它。

```sh
notifs identity add last-order --manager
notifs identity add sister
notifs identity add test-runner
```

将返回的 token 分别保存到各进程的私有环境 `NOTIFS_TOKEN`。`last-order` 的 manager 标记只表示可以配置身份、目标和订阅，不是另一套消息权限规则。它用同一个 token 收发和管理。

人的 CLI：`identity`、`endpoint`、`subscription` 命令。Last Order MCP：`create_identity`、`set_endpoint`、`set_subscription`、`list_subscriptions`、`remove_subscription` 等工具。API 是相同内核的另一入口。

普通身份可以发消息、领取自己的目标；不能修改订阅或领取别人的消息。token 轮换用 `identity rotate <name>`，停用用 `identity disable <name>`；新凭据只返回一次。

## 发送方

只配置 `NOTIFS_BASE_URL` 和 `NOTIFS_TOKEN`；本地可选 `--socket <路径>`。程序或入站 adapter 同样先创建身份，然后向 `/api/messages` 发 `{type,content}`。不需要另建 sender、producer 或 channel。

`Idempotency-Key` 是可选重试标识；同一发送尝试重用原值，不同消息使用新值。客户端库会自动生成并在自动重试中复用。CLI 跨命令重试使用 `--id`。没有匹配订阅返回 `422 unrouted`，不接受消息。

## 接收方

每个接收目标都配置 `name`、`owner` 和投递方式；不同 agent 会话用不同目标名。

```json
{"name":"sister","owner":"sister","delivery":{"kind":"pull"}}
```

省略 delivery 就是 pull。agent/程序配置自己的 token 和目标名，调用 receive，可靠接管后 ack；长处理可 renew。MCP 的 receive/ack/renew 与 CLI/API 操作一致。

由中心交给适配器时，直接把配置放在目标中：

| delivery.kind | config | 接收行为 |
| --- | --- | --- |
| pull | `{}` | agent/程序领取完整批次 |
| webhook | `{"url":"http://host/messages","headers":{}}` | HTTP POST 完整批次，2xx 表示接管 |
| local | `{"logOnly":true}` 或 `{}` | 日志或本机桌面通知 |
| feishu | `{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/..."}` | 飞书群机器人 |
| feishu-app | `{"receiveId":"oc_...","receiveIdType":"chat_id"}` | 飞书应用；服务环境提供 FEISHU_APP_ID / FEISHU_APP_SECRET |
| ntfy | `{"topic":"topic","server":"https://ntfy.sh"}` | ntfy |
| bark | `{"key":"..."}` | Bark |
| wecom | `{"webhookKey":"..."}` | 企业微信机器人 |

没有单独的 channel 对象。适配器凭据通过服务环境或私有配置提供，不提交 Git。外部 adapter 可以选择 pull 来接管并转发，或以 webhook 程序接受中心投递。入站 adapter 使用自己的发送身份把平台内容转为 `{type,content}`；核心不识别平台回调格式。

webhook 格式为 `{id,endpoint,messages:[{id,source,type,content,received_at}]}`，批次 ID 同时放在 Idempotency-Key 头。程序应先可靠保存，再返回 2xx；拒绝或断线会重投。通知 adapter 最后才渲染文本，平台接受不等于用户已读。

## 订阅

```json
{"name":"test-failures","source":"test-runner","type":"test.failed","endpoint":"last-order"}
```

由人调用 `subscription put --config '<json>'`，或由 Last Order 调用 `set_subscription`。source/type 支持 `*`；省略即匹配全部。`all` 可以检查 content，例如 `[{"field":"result.failed","op":"gt","value":0}]`。

接收目标可设置 `max_wait_ms`、`min_interval_ms`、`max_messages`、`max_bytes`。批量不摘要、不生成新业务消息。`paused:true` 暂停交付但保留排队项。重试耗尽保留为 held，通过 resume 恢复。

订阅修改只影响未来消息；相同目标多次命中只投一次。`to` 仅缩小匹配结果。没有因果链、回复关系或任务角色字段。

## 服务配置

环境变量：`NOTIFS_DATA_DIR`、`NOTIFS_CONFIG_DIR`、`NOTIFS_DB`、`NOTIFS_HOST`、`NOTIFS_PORT`、`NOTIFS_BASE_URL`、`NOTIFS_SOCKET`。默认地址 `127.0.0.1:7710`，数据库为数据目录下 `hub.db`，本地 socket 为 `notifs.sock`。

此版本破坏性移除旧入口。旧库不能直接用作新 hub.db；显式指定旧库时启动拒绝，原文件保留。凭据默认读取新的 controller-token，不读取旧 token/admin-token。已有消息若需要迁移，应单独制定数据迁移方案，而不是隐式重新路由。
