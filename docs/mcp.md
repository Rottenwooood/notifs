# MCP

`notifs mcp` speaks MCP over stdio. It is a thin HTTP client: it never touches the
database, so it can point at a local hub or a remote one.

## Configure

### opencode

```jsonc
{
  "mcp": {
    "notifs": {
      "type": "local",
      "command": ["notifs", "mcp"],
      "environment": { "NOTIFY_BASE_URL": "http://127.0.0.1:7710" }
    }
  }
}
```

If your config groups servers under `mcp.servers`, put the same object there instead.
Verify with `opencode mcp list` — it should print `✓ notifs connected`.

### Any other MCP client

| | |
|---|---|
| transport | stdio |
| command | `notifs mcp` |
| env | `NOTIFY_BASE_URL`（默认 `http://127.0.0.1:7710`）、`NOTIFS_TOKEN`（不给就读 `~/.config/notifs/token`） |

## Tools

| tool | arguments | returns | answers |
|---|---|---|---|
| `send` | `type`, `text`, `title?`, `url?`, `severity?`, `dedup_key?`, `data?` | `accepted / deduplicated / dispatches / event_ids` | 发一条通知 |
| `ask` | `text`, `timeout_minutes?` (1–30, default 5), `type?`, `title?`, `severity?`, `data?` | `{status, reply, replied_at, expires_at}` | 发一条并等你**引用回复** |
| `events` | `limit?`, `type?` | 事件列表 | 我发过什么 |
| `deliveries` | `limit?`, `status?` | `channel / status / attempts / error` | 到底送到手机没有 |
| `status` | — | 源、出口、规则、程序、投递计数 | 环境是什么样 |

`events` / `deliveries` 只能看到**调用者所属那个源**自己的数据。

`ask` 的 `status` 是 `answered`（带 `reply`）或 `expired`。超时不是错误，是"没回复"。

## Prompts

注册后变成 `/<server>:<prompt>` 形式的斜杠命令（opencode 下即 `/notifs:write-script`）：

| prompt | 参数 | 产出 |
|---|---|---|
| `write-script` | `event` | 「当某事发生时发 POST」的独立脚本提示词 |
| `write-monitor` | `need` | 托管程序提示词（心跳 / 重启 / 凭据） |
| `poller` | `need` | 声明式轮询配置提示词，不写代码 |

## Resource

`notifs://contract` —— 完整接入契约。agent 需要时自己读，不占常驻上下文。
（opencode 用内置的 `list_mcp_resources` / `read_mcp_resource` 访问。）

## 故意不给的能力

任何工具都不能删规则、改出口、轮换 token。一个犯迷糊的 agent 最多多发一条通知，
不会把中继配置搞坏。管理动作留在 CLI。
