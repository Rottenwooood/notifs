# notifs

可部署在本地或服务器上的订阅通信中心。人、程序和 agent 使用身份 token 发布 `type + content`，中心按订阅主动推送给接收适配器。核心没有团队角色、任务或会话模型。

```text
人 / 程序 / agent ── HTTP、IPC（agent 可经 MCP）── 身份认证
                                                   ↓
                                              订阅路由与持久队列
                                                   ↓ 中心主动交付
                           程序 webhook / agent 宿主 API / 人的通知渠道
```

## 启动与配置

从发布包安装：

```sh
npm install -g notifs@0.2.0
notifs init
notifs start
```

从源码运行：

```sh
pnpm install
pnpm build
node dist/cli.mjs init
node dist/cli.mjs start
```

下文 `notifs` 指构建后的 `node dist/cli.mjs`。人的 CLI 默认读取 `controller-token`，身份为 `owner`。创建普通发送/接收身份，以及可配置订阅的管理身份：

```sh
notifs identity add worker
notifs identity add operator --manager
notifs endpoint put --config '{"name":"worker-hook","owner":"worker","delivery":{"kind":"webhook","config":{"url":"http://127.0.0.1:9000/messages"}}}'
notifs subscription put --config '{"name":"jobs","endpoint":"worker-hook","source":"owner","type":"job"}'
notifs message send '处理这项输入' --type job
```

程序在配置的 URL 收到 HTTP POST，可靠接管后返回 2xx。接收方不调用领取接口。管理身份也可用自己的 token 启动 `notifs mcp`，通过 `set_endpoint`、`set_subscription` 等工具修改同一套配置。

## 发送与接收

发送方只需 **中心地址 + 自己的 token**。HTTP：`POST /api/messages`，Bearer token，正文 `{"type":"job","content":"处理这项输入"}`。agent 通过 MCP `send` 发布；本地 CLI 可经 Unix socket 发送。可选 `to` 只缩小订阅匹配范围。

接收方配置 **目标名 + 所属身份 + adapter 及地址/凭据**。同一个人可有多个目标，每个目标对应一个渠道，各自订阅。

- 程序：`webhook`，收到完整结构化批次。
- agent：宿主自己接收非 user_prompt 输入，并用 notifs MCP `send` 或 HTTP POST 把消息发回中心；中心不解析模型文本。`opencode` 是现有的一种非 user_prompt 输入适配器。
- 人：当前有飞书、企业微信、ntfy、Bark 和本机 Linux 桌面出站适配器；飞书入站由独立 `notifs-feishu-inbound` bridge 通过飞书长连接接入。Discord、Windows 桌面尚未实现。

MCP 负责发送和管理；上下文注入由 agent adapter 调用宿主接口完成。没有公共 `receive/ack/renew` 工具或 API。

## 交付边界

消息和各目标的投递责任一起落库。各目标独立攒批、限频、重试；成功回执表示接管，失败保留队列。至少一次交付要求接收适配器去重；不表示任务完成或用户已读。无匹配订阅返回 422，容量不足拒绝新提交。当前无历史自动清理，性能与长期运行验收尚未完成。

[具体配置](docs/configuration.md) · [MCP](docs/mcp.md) · [完整边界](docs/boundaries.md) · [架构](docs/design/notifs.md) · [发布路线](docs/release-plan.md) · [验收记录](docs/validation/README.md)

开发约定见 [AGENTS.md](AGENTS.md)。MIT license。
