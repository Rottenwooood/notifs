# notifs

程序、agent 和人共用的本地通信中心。发送者只提交 `type + content`；人或 Last Order 设置订阅；中心持久排队并交付给指定接收方。

```text
发送身份 + token → 消息 → 订阅 → 接收目标
                                  ├─ pull：agent / 程序领取并确认
                                  └─ adapter：中心交给 webhook / 桌面 / 飞书等
```

## 人怎样配置，Last Order 怎样管理

```sh
pnpm install
pnpm build
node dist/cli.mjs init
node dist/cli.mjs start
```

以下 `notifs` 指构建后的 `node dist/cli.mjs`。人默认使用配置目录里的 `controller-token`，身份为 `owner`。

```sh
notifs identity add last-order --manager
notifs identity add sister
# 将两个返回的 token 各自保存到对应进程的私有环境 NOTIFS_TOKEN。

notifs endpoint put --config '{"name":"last-order","owner":"last-order"}'
notifs endpoint put --config '{"name":"sister","owner":"sister"}'
notifs subscription put --config '{"name":"questions","endpoint":"last-order","source":"sister","type":"question"}'
```

Last Order 使用自己的 token 启动 `notifs mcp`，可直接调用 `set_endpoint`、`set_subscription`、`list_subscriptions`、`remove_subscription`，也能正常收发消息。普通 sister 只暴露收发工具。两者没有不同的消息契约，也不需要切换 token 来管理或发言。

## 发送方怎样配置

所有发送方，包括 agent、程序和入站适配器，都配置 **中心地址 + 自己的 token**。没有独立的 sender 注册表。

```sh
NOTIFS_TOKEN='<sister 的 token>' notifs message send '这一步需要决定' --type question
```

HTTP 为 `POST /api/messages`，认证放 Bearer header，正文只有：

```json
{"type":"question","content":"这一步需要决定"}
```

可选 `to` 通过发送操作或 `X-Notifs-To` 缩小目标范围，不绕过订阅。

## 接收方怎样配置

agent 和程序使用 pull 目标，配置 **中心地址 + 自己的 token + 目标名**：

```sh
NOTIFS_TOKEN='<last-order 的 token>' notifs message receive last-order --wait 30
# 可靠接管批次后：
NOTIFS_TOKEN='<last-order 的 token>' notifs message ack '<batch-id>' --lease '<lease>'
```

程序选择由中心回调时，直接配置 webhook 接收目标，不再先建 channel：

```sh
notifs endpoint put --config '{"name":"build-hook","owner":"sister","delivery":{"kind":"webhook","config":{"url":"http://127.0.0.1:9000/messages"}}}'
notifs subscription put --config '{"name":"build-results","endpoint":"build-hook","type":"build.*"}'
```

webhook 收到包含完整 `messages` 的批次；持久接管后返回 2xx。人的桌面目标可用 `delivery:{"kind":"local","config":{}}`；飞书等配置见 [配置手册](docs/configuration.md)。

## 运行与边界

- 人的 CLI 和 Last Order 的 MCP 管理同一套身份、目标、订阅；没有第二类发送权限规则。
- SQLite 保存消息、投递和确认；按目标攒批、限频、保序。合并保留全部内容，过载拒绝新消息，不丢已接受消息。
- HTTP 和 IPC 都由接收方领取；push 适配器是同一队列的消费者。MCP 不负责启动已退出的模型会话。
- 已接管不等于任务完成；至少一次交付要求接收方去重。
- 当前历史和幂等记录不自动清理；仍需性能、持续运行和安装分发验收。
- 只保留这套架构。旧 API、notify/ask、rule/channel、监控托管及其文档已删除；旧数据库不会被自动迁移或删除。

[配置手册](docs/configuration.md) · [MCP](docs/mcp.md) · [架构](docs/design/notifs.md) · [阶段验收](docs/validation/README.md)

开发及验收约定见 [AGENTS.md](AGENTS.md)。MIT license。
