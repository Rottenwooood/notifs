# 部署

先构建并完成 `notifs init`，将 notifs.service 的 Node/安装路径和用户配置目录改为实际位置，再用 systemd 启动。该服务只运行一个订阅中心，没有旧 notify/rule/channel 管道。

服务环境使用 `NOTIFS_*` 变量，见 [配置手册](../docs/configuration.md)。人的凭据在 controller-token；Last Order 和其他参与者各持自己的 NOTIFS_TOKEN。adapter 所需平台凭据只放私有服务环境。

默认只绑定本机；远端客户端可通过 SSH 隧道访问。不直接暴露未保护的管理凭据。
