# 阶段 8：中心迁到 relay，保留出站，关闭返程

## 结论

中心已从本机迁到 relay，只保留 OpenCode → relay 中心 → 飞书出站；飞书 → OpenCode 返程未配置。

## relay

- 新包：`notifs@0.2.0`，全局安装 `/usr/local/lib/node_modules/notifs`。
- 服务：`/etc/systemd/system/notifs-0.2.service`，active。
- 地址：`127.0.0.1:7802`。
- 配置：`/root/.config/notifs-0.2`，env/token 600。
- 数据：`/root/.local/share/notifs-0.2`。
- 出站目标：`feishu-human`，飞书应用机器人，群 `oc_5a2f9f2c3164f26dae8750b8ae8c9632`。
- 订阅：`agent-to-feishu`，source=`agent`，type=`*`。
- 返程 bridge：未安装/未启动。

直接出站验证：消息 `c6666890-c5a9-4623-80b3-0f5047347095`，投递 `feishu-human=received`。

## 本机

- 本地中心 `notifs-0.2.service`：已停止并禁用。
- `notifs-0.2-tunnel.service`：active，`-L 127.0.0.1:7802:127.0.0.1:7802`。
- OpenCode 生产会话：`ses_e39736401ffeFdHFwofkoKS028`，location `~/.local/share/notifs-0.2/agent-relay`。
- MCP：新包 `notifs mcp`，`NOTIFS_BASE_URL=http://127.0.0.1:7802`，agent token 600。

OpenCode 出站验证：消息 `8a4971ef-9f53-467a-af60-2695e1667f88`，`type=reply`，`title=OpenCode`，投递 `feishu-human=received`。

## 旧 relay

- 旧 `notifs.service`：停止、禁用、删除 unit。
- 旧全局 npm 包：卸载。
- 旧数据备份：`/root/notifs-old-backup-20261111.tgz`，600。
- 旧 local `notifs-tunnel.service`：停止、禁用、删除。

## 边界

- 返程关闭；飞书消息不会进入 OpenCode。
- 本机 OpenCode 到 relay 中心走 SSH 隧道；relay 中心只监听 localhost。
- relay 中心没有 `OPENCODE_HEADERS`，也不配置 `opencode` 入站目标。
- 72 小时观察窗口自 2026-11-10 起算、2026-11-13 到期，结论尚未归档。
