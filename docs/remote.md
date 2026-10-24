# 把中继放到服务器（SSH 隧道）

适用场景：中继要 24×7 常驻，笔记本会关机。
**不开公网端口、不需要域名、不需要备案。**

```
笔记本 / 其他机器
   └── ssh -L 127.0.0.1:7710 ──▶ 服务器 127.0.0.1:7710
                                      ├── notifs.service
                                      ├── feishu-events（长连接）
                                      └── routine
```

中继只绑 `127.0.0.1`，公网唯一开放的端口是你本来就在用的 SSH。

## 一、服务器

```sh
apt install -y nodejs npm     # Ubuntu 22.04+ 自带 Node ≥ 20
npm i -g notifs
```

默认路径（以 root 运行）：

| 内容 | 位置 |
|---|---|
| 数据库 / 主密钥 / 程序状态 | `/root/.local/share/notifs/` |
| token / env | `/root/.config/notifs/` |

`/etc/systemd/system/notifs.service`：

```ini
[Unit]
Description=notifs relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=/root
ExecStart=/usr/bin/node /usr/local/lib/node_modules/notifs/dist/server.mjs
EnvironmentFile=-/root/.config/notifs/env
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload && systemctl enable --now notifs
curl -s 127.0.0.1:7710/health
```

> `ExecStart` 用 `npm root -g` 下的实际路径；升级 Node 后确认它没变。

## 二、客户端（笔记本）

```ini
# ~/.config/systemd/user/notifs-tunnel.service
[Unit]
Description=notifs SSH tunnel to relay
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:7710:127.0.0.1:7710 root@<服务器IP>
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now notifs-tunnel
curl -s 127.0.0.1:7710/health      # 现在返回的是服务器上的中继
```

之后 **`notifs notify`、`notifs mcp`、你自己的脚本全都不用改**——它们仍然发往
`127.0.0.1:7710`，只是这条路换成了隧道。

## 三、什么变了

| | 本机中继 | 服务器中继 |
|---|---|---|
| 发通知 / MCP / `ask` | 正常 | 正常（走隧道） |
| `notifs status/events/deliveries` | 读本机库 | **要在服务器上跑**：`ssh root@<IP> notifs …` |
| `local` 桌面出口 | 可用 | **不可用**（无 GUI），用飞书 |
| 可用性 | 笔记本开机时 | 24×7 |

**只能有一个中继占用 7710**：切过去时先停掉本机的 `notifs.service`。

## 四、迁移数据

```sh
# 笔记本
systemctl --user disable --now notifs
sqlite3 ~/.local/share/notifs/notifs.db 'PRAGMA wal_checkpoint(TRUNCATE);'
tar czf - -C ~/.local/share notifs | ssh root@<IP> 'tar xzf - -C /root/.local/share'
tar czf - -C ~/.config notifs     | ssh root@<IP> 'tar xzf - -C /root/.config'
ssh root@<IP> 'sed -i "s|/home/<你>|/root|g" /root/.config/notifs/env'

# 服务器
systemctl enable --now notifs
```

迁移完先别删本机那份，确认服务器上的 `notifs status` 和飞书都正常再收。

## 五、注意事项

- **`ask` 的长轮询**最多 300 秒。SSH 隧道没有反代超时，所以这里不需要调参；
  如果改走公网 HTTPS 反代，要把代理超时调大或把 `wait` 降到 30–50 秒。
- **`feishu-events` 需要依赖**：把 producer 目录拷到服务器后，在它目录里
  `npm install`（它依赖 `@larksuiteoapi/node-sdk`）。
- **备份**：`notifs.db` 和 `master.key` 必须一起备份；只有库没有 key，加密凭据解不开。
- **不要**把 7710 直接开在公网。要么走本文的隧道，要么在前面加 Caddy 做 HTTPS。
