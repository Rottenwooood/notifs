# deploy

三个 systemd 单元 + 一个 helper。复制、替换 `<...>`、enable。

| 文件 | 放哪 | 作用 |
|---|---|---|
| `notifs.service` | 服务器 `/etc/systemd/system/` | 中继本体 |
| `notifs-tunnel.service` | 客户端 `~/.config/systemd/user/` | SSH 隧道（`-L` 7710 + `-R` 7711） |
| `notifs-desktop-sink.service` | 客户端 `~/.config/systemd/user/` | 把 webhook 变成桌面通知 |
| `desktop-sink.mjs` | 客户端 `~/.local/bin/notifs-desktop-sink.mjs` | sink 本体 |

完整流程（含数据迁移、规则、安全注意事项）：[`../docs/remote.md`](../docs/remote.md)
