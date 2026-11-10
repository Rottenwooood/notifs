# OpenCode 宿主接入

这个目录定义 OpenCode 侧的 **agent profile**，不是 notifs 中心的一部分。

## 组成

- `agents/notifs.md`：绑定到会话的 system prompt。它规定所有人类可见输出和问题都写进最终文本，禁止本地 `question/form` 等待，禁止重复调用 notifs `send`。
- `opencode.example.json`：注册 `notifs` agent，并尝试拒绝 `question`、`form` 权限。

## 安装

把 agent profile 合并到 OpenCode 的全局或项目配置；`system` 的 `{file:...}` 路径改成 `agents/notifs.md` 的实际路径。不要覆盖原有 `agents`、`mcp`、`provider` 配置。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "notifs": {
      "mode": "primary",
      "system": "{file:/absolute/path/to/integrations/opencode/agents/notifs.md}",
      "permissions": [
        {"action": "*", "resource": "*", "effect": "allow"},
        {"action": "question", "resource": "*", "effect": "deny"},
        {"action": "form", "resource": "*", "effect": "deny"}
      ]
    }
  }
}
```

创建会话时把 agent 固定为 `notifs`：

```json
{
  "title": "notifs",
  "agent": "notifs",
  "model": {"providerID": "opencode-go", "id": "deepseek-v4.1-flash"}
}
```

然后在回复桥启动环境中设置：

```sh
OPENCODE_AGENT=notifs
OPENCODE_SESSION=ses_...
```

回复桥会先读 `/api/session/{id}`，如果 `agent` 不是 `notifs`，直接拒绝启动。这样 prompt/工具权限和传输适配器绑定在同一个会话上。

## 出口唯一性

`v0.2.0` 使用宿主回复桥作为唯一 agent 出口：

- agent 不调用 notifs `send` 重复发送同一回复。
- 旧 `notify-reply` 插件在 notifs 会话中停用，避免旧 notifs 重复收到。
- 回复桥只发布最终文本，不发布 reasoning 和工具过程。

如果以后改成 agent 自己通过 notifs MCP 发送，必须同时停用回复桥，否则会出现两条出口。
