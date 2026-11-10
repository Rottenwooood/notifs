# 阶段 7：v0.2.0 发布与生产切换

## 结论

`v0.2.0` 构建、测试、打包、干净安装、MCP 闭环、崩溃恢复和本地生产切换已完成；72 小时观察仍在进行。

发布边界已按新契约执行：

- 中心 → agent：synthetic / 非 user_prompt。
- agent → 中心：MCP `send` 或 HTTP POST。
- 不存在解析模型最终文本的回复桥。

## 构建与安装

```text
pnpm typecheck 通过
pnpm test      10 个测试文件、58 项通过
pnpm build     dist/server.mjs、dist/cli.mjs、dist/feishu-inbound.mjs
npm pack       notifs-0.2.0.tgz
```

干净目录 `npm install notifs-0.2.0.tgz` 后：

- `npx notifs init` 生成 controller token 和数据库；
- `npx notifs start` 健康检查返回 `{"ok":true}`；
- `npx notifs service install --name ...` 生成 systemd unit；
- `npx notifs backup <path>` 生成 600 权限备份。
- 恢复演练：备份后新建一个身份，停服务执行 `restore --force`，重启后身份数回到备份时的 1 个，服务健康检查通过。

## MCP 闭环

2026-11-10T14:21Z：

- 人在飞书回复 `MCP_LOOP_20261110`。
- 入站消息 `4c9242b1-3798-48ca-88ca-88fefa0d10ec`，投递 `agent-opencode=received`。
- 模型在 OpenCode 会话中调用 `notifs.send`，消息 `da519e1b-543e-4c84-95bd-e45e2bb6d9a0`，`source=agent`、`type=reply`。
- 投递 `feishu-human=received`。
- 模型最终文本是“已通过 notifs 回复…”，实际 MCP 内容是另一段“收到 MCP_LOOP…”。中心只发出 MCP 内容，没有解析最终文本。

## 崩溃恢复

2026-11-10T14:23Z：构建产物启动中心，发布 `crash.test` 后 `SIGKILL`，重启并启动 webhook 接收端；消息 `46a093c9-9926-42a3-8829-40436b18b951` 成功重新投递。

## 生产切换

采用发布路线中的 A 形态（全本地）：

- 发布包：`~/.local/lib/notifs-0.2/node_modules/notifs`。
- 配置：`~/.config/notifs-0.2`，权限 600。
- 数据：`~/.local/share/notifs-0.2`。
- 服务：`notifs-0.2.service` active；`notifs-feishu-0.2.service` 已停止并禁用（返程暂不配置）。
- 中心：`127.0.0.1:7802`。
- agent 会话：`ses_e3a23b489ffef1tWCcZWiPJ2Zn`，agent `notifs`。
- 旧 relay `feishu-events`：disabled / stopped。
- 旧 relay notifs 服务：已停止、禁用并删除 unit；旧 npm 全局包已卸载。
- 旧数据备份：`/root/notifs-old-backup-20261111.tgz`，权限 600。
- 本地旧 `notifs-tunnel.service`：已停止、禁用并删除 unit。

2026-11-10T14:30Z 生产闭环：

- 人回复 `PROD_CUTOVER_20261110`。
- 入站消息 `86bd3989-92bb-4541-9e90-e064476157cb`，`human.message`，投递 `agent-opencode=received`。
- agent 通过 MCP 发送 `question` 消息 `9686bbfc-3f2f-4311-b99d-5b4a7bb611f7`，投递 `feishu-human=received`。
- 飞书 API 接受，回到同一个群。

## 出站与 IPC 验证

2026-11-10T17:14Z，关闭返程后直接向 OpenCode 注入 synthetic 出站测试：

- OpenCode 调用 MCP `send`，消息 `81705c85-95ba-4ef8-8165-3467948fb6e6`。
- `type=reply`，`content={title:"OpenCode", text:"OpenCode → Feishu 出站测试成功"}`。
- 投递 `feishu-human=received`。

2026-11-10T17:12Z，CLI 经本地 Unix socket 发送：

- socket：`~/.local/share/notifs-0.2/notifs.sock`，权限 600。
- 消息 `e5749fc2-fbb9-4855-8b1f-4022c84b50cc`，投递 `feishu-human=received`。
- 证明 HTTP/MCP 之外，本地 IPC 使用同一身份、订阅和投递语义。

## 回滚

1. `systemctl --user stop notifs-feishu-0.2`
2. relay 上 `notifs watcher enable feishu-events`
3. `systemctl restart notifs`（relay 旧服务）
4. 确认旧 producer `status=running`
5. 本地 `notifs-0.2` 和新数据保留，不删除

## 未完成

- 72 小时观察尚未结束；当前只观察出站、重复投递和 held。
- 返程（飞书入站 → OpenCode）按本次要求未配置；`notifs-feishu-0.2` 保持停止。
- 全本地形态依赖本机常开；如果本机休眠，出站中心不可用。
- 其他 agent 宿主仍需按 `integrations/agent/README.md` 接入；本轮只使用现有 OpenCode 作为测试宿主，没有继续开发 OpenCode 专用 adapter。
