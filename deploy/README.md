# 部署

两种安装方式，二选一：

- 用户级：`notifs service install` 生成 `~/.config/systemd/user/notifs.service`，不自动启用；再用 `systemctl --user enable --now notifs`。日常推荐这种方式，详见[配置手册](../docs/configuration.md)。
- 系统级：本目录的 `notifs.service` 是 root 运行时的模板，适用于 relay 这类整机部署。把 `ExecStart` 的 Node 与安装路径、`EnvironmentFile` 的配置目录改成实际位置，再执行 `systemctl daemon-reload && systemctl enable --now <unit>`。

服务环境使用 `NOTIFS_*` 变量，见[配置手册](../docs/configuration.md)。人的凭据在 `controller-token`；每个参与者各持自己的 `NOTIFS_TOKEN`。adapter 所需平台凭据只放私有服务环境。

默认只绑定本机；远端客户端可通过 SSH 隧道访问。不直接暴露未保护的管理凭据。
