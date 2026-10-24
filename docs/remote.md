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

## 六、桌面通知（可选）

服务器没有 GUI，`local` 出口在服务器上不可用。要让通知回到笔记本桌面，
用一条**反向隧道**把服务器的 webhook 打回本地：

```
服务器 notifs ──webhook──▶ 127.0.0.1:7711 ──ssh -R──▶ 笔记本 sink ──▶ notify-send
```

**1. 隧道加一条反向转发**（和 `-L` 写在同一个 ExecStart 里）：

```ini
ExecStart=/usr/bin/ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:7710:127.0.0.1:7710 \
  -R 127.0.0.1:7711:127.0.0.1:7711 \
  root@<服务器IP>
```

**2. 服务器上加出口和规则**：

```sh
notifs channel add desktop --kind webhook \
  --config '{"url":"http://127.0.0.1:7711/notify","headers":{"x-sink-token":"<随机串>"}}'

# 例：除了 ascend 以外的事件都弹桌面
notifs rule add --name '全部 → 桌面' \
  --when '{"not":[{"field":"source","eq":"ascend"}]}' \
  --actions '[{"channel":"desktop"}]' --priority 100
```

**3. 笔记本上的 sink**（`~/.local/bin/notifs-desktop-sink.mjs`，见文末代码），
配一个 systemd 用户服务：

```ini
[Unit]
Description=notifs desktop sink
After=default.target

[Service]
Type=simple
Environment=DISPLAY=:0
Environment=XAUTHORITY=/run/user/1000/gdm/Xauthority
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
Environment=NOTIFS_SINK_TOKEN=<同一个随机串>
ExecStart=/usr/bin/node %h/.local/bin/notifs-desktop-sink.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

**4. 安全**：`GatewayPorts yes` 时 `ssh -R` 会被强制绑到 `0.0.0.0`，
所以额外做两层：`ufw deny 7711/tcp`，并且 sink 校验 `x-sink-token`。

**5. 笔记本合盖时**：反向隧道断开，桌面投递会失败并按 outbox 退避重试；
在重试窗口内开机，迟到的通知仍会补弹。

<details>
<summary>完整 sink 代码</summary>

```js
#!/usr/bin/env node
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.NOTIFS_SINK_PORT || 7711);
const TOKEN = process.env.NOTIFS_SINK_TOKEN || '';
const log = (...a) => console.error(new Date().toISOString(), ...a);

const seen = new Set();
const order = [];
function firstTime(key) {
  if (!key) return true;
  if (seen.has(key)) return false;
  seen.add(key); order.push(key);
  if (order.length > 200) seen.delete(order.shift());
  return true;
}

function notify(title, body, severity) {
  const urgency = severity === 'critical' ? 'critical' : 'normal';
  return new Promise((resolve) => {
    execFile('notify-send', ['--app-name=notifs', `--urgency=${urgency}`, title, body],
      (err) => resolve(!err));
  });
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/notify')) return res.writeHead(404).end();
  if (TOKEN && req.headers['x-sink-token'] !== TOKEN) return res.writeHead(403).end('forbidden');

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let msg = {};
    try { msg = JSON.parse(raw || '{}'); } catch { /* ignore */ }
    if (firstTime(req.headers['x-notify-idempotency-key'])) {
      const title = String(msg.title || 'notifs');
      const body = [msg.body, msg.url].filter(Boolean).join('\n');
      const ok = await notify(title, body, msg.severity);
      log(`[notify] ${ok ? 'ok' : 'FAILED'} ${title}`);
    }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
}).listen(PORT, '127.0.0.1', () => log(`[sink] listening 127.0.0.1:${PORT}`));
```

</details>

## 五、注意事项

- **`ask` 的长轮询**最多 300 秒。SSH 隧道没有反代超时，所以这里不需要调参；
  如果改走公网 HTTPS 反代，要把代理超时调大或把 `wait` 降到 30–50 秒。
- **`feishu-events` 需要依赖**：把 producer 目录拷到服务器后，在它目录里
  `npm install`（它依赖 `@larksuiteoapi/node-sdk`）。
- **备份**：`notifs.db` 和 `master.key` 必须一起备份；只有库没有 key，加密凭据解不开。
- **不要**把 7710 直接开在公网。要么走本文的隧道，要么在前面加 Caddy 做 HTTPS。
