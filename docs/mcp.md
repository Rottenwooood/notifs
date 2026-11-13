# MCP：发送与管理

人先用 CLI 创建身份，管理身份加 `--manager`；token 存在对应运行时的私有环境 `NOTIFS_TOKEN`。所有身份都运行同一个 `notifs mcp`，配置 `NOTIFS_BASE_URL`，本地也可用 `--socket <路径>`。

OpenCode 项目配置。OpenCode 2.x 的 `mcp` 是“服务器名 → 服务器配置”的映射，没有 `servers` 这一层：

```json
{
  "mcp": {
    "notifs": {
      "type": "local",
      "command": ["notifs", "mcp"],
      "environment": {
        "NOTIFS_BASE_URL": "http://127.0.0.1:7710",
        "NOTIFS_TOKEN": "{file:/run/secrets/agent-notifs-token}"
      }
    }
  }
}
```

token 用 `{file:...}` 注入，不提交到 Git。`opencode mcp list` 检查连接，列出 `notifs` 且状态为 connected 即配置生效。

所有身份：`send`、`inspect`。管理身份额外提供：

| 配置对象 | 工具 |
| --- | --- |
| 身份 | create_identity、list_identities、rotate_identity、set_identity_enabled |
| 目标 | set_endpoint、list_endpoints、resume_endpoint |
| 订阅 | set_subscription、list_subscriptions、remove_subscription |

例如管理者调用 set_endpoint：

```json
{"name":"worker-session","owner":"worker","delivery":{"kind":"opencode","config":{"url":"http://127.0.0.1:4096","session":"ses_...","headers_env":"OPENCODE_HEADERS"}}}
```

再调用 set_subscription `{"name":"jobs","endpoint":"worker-session","source":"operator","type":"job"}`。operator 经 send 发布后，中心直接调用配置的宿主接口，不要求 worker 调用工具领取。宿主 session、模型和权限由使用方创建与选择。

**MCP 工具连接本身不能保证模型获得新上下文。** 接收必须配置实际 adapter；当前 OpenCode adapter 使用 2.x 的持久输入接口。其他宿主需要自己的接入，见[配置](configuration.md)。CLI 与 MCP 修改同一套配置，无专属主 agent 角色。
