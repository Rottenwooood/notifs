# Last Order 与普通 agent 的 MCP 配置

人先通过 CLI 创建身份：

```sh
notifs identity add last-order --manager
notifs identity add sister
```

分别把 token 放进对应运行时的私有环境 `NOTIFS_TOKEN`。两个进程都运行同一个 `notifs mcp`；`NOTIFS_BASE_URL` 指向中心，或使用 `--socket <路径>`。

OpenCode 项目配置：

```json
{"mcp":{"servers":{"notifs":{"type":"local","command":["notifs","mcp"],"environment":{"NOTIFS_BASE_URL":"http://127.0.0.1:7710"}}}}}
```

身份 token 应从私有环境或本地配置提供，不提交到 Git。运行 `opencode mcp list` 检查连接。

所有身份提供 send、receive、ack、renew、inspect。拥有 manager 标记的 Last Order 还提供：

| 目标 | 工具 |
| --- | --- |
| 配置身份 | create_identity、list_identities、rotate_identity、set_identity_enabled |
| 配置接收方 | set_endpoint、list_endpoints、resume_endpoint |
| 配置订阅 | set_subscription、list_subscriptions、remove_subscription |

例如 Last Order 为 sister 设置输入：

```json
{"name":"sister","owner":"sister","delivery":{"kind":"pull"}}
```

调用 set_endpoint；再以 `{"name":"instructions","endpoint":"sister","source":"last-order","type":"instruction"}` 调用 set_subscription。随后 send `{type:"instruction",content:"..."}`，sister 用自己的凭据 receive `sister`。

人通过 CLI 修改的是同一套配置，立即对后续消息生效。不再有通知模式、版本切换或第二套 rule/channel。
