# MCP 接入

MCP 是客户端：通过 HTTP 或 v2 本地 IPC 与运行中的中心通信，不直接操作数据库。

## OpenCode

OpenCode v2 在项目 `opencode.json` 中使用 `mcp.servers`：

```json
{
  "mcp": {
    "servers": {
      "notifs": {
        "type": "local",
        "command": ["notifs", "mcp", "--v2"],
        "environment": {"NOTIFY_BASE_URL": "http://127.0.0.1:7710"}
      }
    }
  }
}
```

`NOTIFS_TOKEN` 指定普通身份凭据；缺省读取配置目录 `token`。不同身份配置不同服务器名和 token。凭据放私有环境或本地配置，不提交 Git。`--socket <路径>` 可让 v2 改用 Unix socket。

`opencode mcp list` 可查看连接状态。其他 MCP 客户端把相同 command 和 environment 放进各自的服务器配置格式。

## 两种模式

| 启动方式 | 工具 | 消息与职责 |
| --- | --- | --- |
| `notifs mcp --v2` | send、receive、ack、inspect | `type + content`，按订阅路由，整批接收后显式确认 |
| `notifs mcp` | send、ask、events、deliveries、status | 保留的 v1 通知协议，发送 `type + text` |

v2 send 可选 `to`，只缩小订阅结果；receive 使用接收目标名；ack 需要批次 id 与 lease。v2 没有回复关联或因果字段，也不提供订阅管理工具。配置关系由人或 Last Order 通过管理 CLI/API 完成。

MCP 工具不会让已退出的 agent 自动运行，也不能自动保证接收的消息已持久进入宿主。宿主负责接管整批输入、去重和安排模型调用。

v1 仍提供 write-script、write-monitor、poller 三个 prompts 和 `notifs://contract` 资源；ask 的 Feishu 引用回复条件见 [README](../README.md#ask--send-then-wait-for-a-reply)。v1 events/deliveries 只返回调用身份的数据；status 是单用户部署的全局概览。

完整使用方式见 [团队通信指南](messaging.md) 与 [运行及兼容入口](usage.md)。
