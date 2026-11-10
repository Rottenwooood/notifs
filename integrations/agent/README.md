# agent 接入契约

这个目录只定义 **agent 如何与 notifs 通信**，不绑定具体模型或宿主。

## 两个方向

```text
中心 → agent 宿主：宿主自己的非 user_prompt 输入接口
agent → 中心：MCP send 或 HTTP POST
```

### 中心 → agent

中心不会把消息写成用户提示词。具体宿主 adapter 负责调用该宿主的非 user_prompt 输入接口，例如 OpenCode 的 `/api/session/{id}/synthetic`。其他宿主使用自己的 system/developer/event 输入，不由中心解析。

### agent → 中心

agent 必须使用自己的 notifs 身份显式发送：

- MCP `send`；或
- `POST /api/messages`，`Authorization: Bearer <agent token>`，body `{"type":"reply","content":{"text":"..."}}`。

中心不读取模型的最终文本、reasoning、日志或工具输出，也不存在文本回复桥。

## MCP 配置

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

agent 发送后结束本轮。需要人回答时使用 `type=question`；普通回复使用 `type=reply`。订阅负责把这两类消息路由到人类目标。

## HTTP 示例

```sh
curl -X POST http://127.0.0.1:7710/api/messages \
  -H "Authorization: Bearer $NOTIFS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: agent-$(date +%s%N)" \
  -d '{"type":"reply","content":{"text":"已完成"}}'
```

重试时必须复用同一个 `Idempotency-Key`；相同 ID 不同内容返回 409。

## 宿主 prompt 的最低要求

宿主应要求 agent：

- 所有面向人的回复和问题都通过 notifs MCP `send` 或 POST 发出；
- 需要澄清时发送 `question`，然后结束本轮；
- 不使用本地 `question/form/permission` 等待；
- 不把最终文本当作已发送的消息。

prompt 和工具权限属于宿主配置，不属于 notifs 中心，也不属于 `DeliveryAdapter`。
