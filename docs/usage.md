# 上手：怎么用 notify-hub（CLI 形态）

> 本项目的**主入口是命令行**。Web 管理界面是可选的附加物（`apps/web/dist` 存在时才挂载），
> 不构建它也不影响任何功能。

## 0. 一分钟理解

它就是一条**事件管道**：

```
源（发现变化）──POST──▶ 中心（去重 · 规则匹配）──▶ 出口（弹通知）
```

你要做的永远只有三件事：**建出口 → 建规则 → 让某个源往这里发事件**。
其余（去重、重试、崩溃补发、程序托管）中心自己管。

判断"什么算变化"这件事**不在中心**——那由源侧的监控程序负责。中心只认"一条事件"。

---

## 1. 启动

```sh
cd ~/dev/notify-hub
pnpm start            # 前台启动；会自动读 ~/.config/notify-hub/env
```

常驻用 systemd（第 7 节）。**纯 CLI 用法不需要创建登录用户**（那是 Web 界面才要的）。

---

## 2. 最小可用路径（三条命令）

```sh
# ① 建一个出口（桌面通知，本机可见）
pnpm cli channel add desktop --kind local --config '{}'

# ② 建一条规则：什么情况走这个出口（这里 = 全部事件）
pnpm cli rule add --name '全部 → 桌面' --when '{}' --actions '[{"channel":"desktop"}]'

# ③ 建一个信息源，拿到 token（只打印一次）
pnpm cli source add cli
```

然后随便发一条：

```sh
curl -s -X POST http://127.0.0.1:7710/api/v1/events \
  -H "Authorization: Bearer <上一步的 token>" \
  -H 'content-type: application/json' \
  -d '{"type":"demo.hello","text":"你好 notify-hub"}'
```

桌面弹通知；`pnpm cli deliveries` 能看到一条 `sent`。

> **最常见的坑**：只建出口、没建规则 → 一条通知都不会有。
> 出口是"通往哪"，规则是"什么情况走它"。

---

## 3. 让外部程序发进来（最常用）

中心常驻一个接收接口。**任何程序**只要按格式 POST，就会被广播到所有匹配的出口。

```
POST /api/v1/events
Authorization: Bearer <信息源的 token>
Content-Type: application/json
```

**请求体**：单条对象，或数组（一次最多 100 条）。

```json
{ "type": "disk.low", "text": "/data 剩余 3%" }
```

**只有 `type` 和 `text` 必填**；可选 `title` `url` `severity` `dedup_key` `at` `data`。
多写未定义的字段会被拒（严格模式，防止格式漂移）。

**返回**：

| 码 | 含义 | 你该做什么 |
|---|---|---|
| `202 {accepted, dispatches:N}` | 收下了，已派发到 N 个出口 | 完事 |
| `202 {deduplicated:true}` | **成功**，只是被判重复 | 不要重试 |
| `400 {error}` | 格式错 | 修格式 |
| `401` / `403` | token 错 / 源被停用 | 查 token |

**去重**：不填 `dedup_key` 时按「源 + 类型 + 正文」的哈希去重，有效期默认 **24 小时**。
所以内容完全相同的告警只会打扰你一次（通常正是想要的）；
要每次必到，就让程序带上每次不同的 `dedup_key`（例如拼上时间戳）。

**广播给多个出口** = 在同一条规则的 `actions` 里列多个：

```sh
pnpm cli rule add --name '全部 → 桌面 + 飞书' --when '{}' \
  --actions '[{"channel":"local-desktop"},{"channel":"feishu-notify"}]'
```

---

## 4. 让外部 agent（如 opencode）写一个监控程序

> 这一节的命令用 `monitor`；旧名 `producer` 仍可用（完全等价）。

中心**不负责判断变化**——那是监控程序的事。你让 opencode 写一个程序，按上面的格式往中心发 POST 即可。
如果希望中心**替你托管这个程序**（自动拉起、心跳、崩了重启、日志），用这套流程：

```sh
# ① 生成骨架（清单 + 入口 + README），交给 opencode 去填逻辑
pnpm cli monitor init my-watch

# ② opencode 照着 producers/my-watch/README.md 和 docs/producer-protocol.md 改：
#    - producer.json 里的 config（你的参数）、credentials（需要的密钥名）
#    - index.mjs 里的 TODO（"什么算变化" + 发 POST）

# ③ 静态校验：清单合法？入口存在？解释器可用？凭据能解析到？
pnpm cli monitor check my-watch

# ④ 试运行：把程序真跑一遍，但收到的 POST 会被**拦下**，只打印"它将会上报什么"
pnpm cli monitor try my-watch --seconds 15

# ⑤ 上线：中心拉起它，之后自动看护
pnpm cli monitor enable my-watch
```

**中心替你管这些**（你不用写）：

| 能力 | 说明 |
|---|---|
| 拉起 | 启用后自动启动，日志落盘 `data/producers/<slug>/hub.log` |
| 心跳 | 程序每 30s 报一次；超 90s 没心跳判卡死并重启 |
| 崩溃重启 | 非 0 退出按 5s→15s→1m→…→6h 退避重启；`exit 0` 视为正常结束不重启 |
| 凭据注入 | 程序在 `credentials` 里声明名字，中心从加密密钥库取值注入成环境变量 |
| 目录即期望状态 | 把目录放进 `producers/` 就生效；删掉目录后 `producer sync` 会清理记录 |

**opencode 需要的全部信息**：`docs/producer-protocol.md`（把它整份贴给模型当上下文就行）。
骨架里的 `README.md` 也写了这套流程。

---

## 5. 命令速查（全量）

```sh
pnpm cli status                      # 一眼看全部：源/出口/规则/程序/投递/密钥
pnpm cli events [--limit 20]         # 最近的事件流

# 信息源（外部程序的身份）
pnpm cli source add <name> [--dedup-ttl <秒>]      # 打印 token（只显示一次）
pnpm cli source list | enable <name> | disable <name> | rm <name>
pnpm cli source token <name>                        # 重置并打印新 token

# 出口
pnpm cli channel add <name> --kind <kind> --config '<json>'
pnpm cli channel list | enable <name> | disable <name> | rm <name>
#   kind: local | webhook | ntfy | bark | wecom | feishu | feishu-app

# 规则
pnpm cli rule add --name <n> --when '<json>' --actions '<json>' [--priority 100] [--exclusive]
pnpm cli rule list | enable <name> | disable <name> | rm --name <name>

# 监控程序
pnpm cli monitor init <slug> [--kind managed|poller] [--name <显示名>] [--force]
pnpm cli monitor check <slug>
pnpm cli monitor try <slug> [--seconds 15]
pnpm cli monitor sync | list | enable <slug> | disable <slug> | logs <slug> [--tail 80]
pnpm cli monitor rm <slug> [--dir]

# 凭据 / 运维
pnpm cli secret set <名称> [--value <值>]     # 不给 --value 则从 stdin 读（不进 shell 历史）
pnpm cli secret list | rm <名称>
pnpm cli backup [--to <目录>]                 # 数据库快照 + 主密钥
pnpm cli llm check                            # 探测模型端点（只有内置生成才需要）

# 测试与调试
pnpm cli emit --server <base> --token <t> --type <type> --text <text> [--title] [--url] [--dedup-key] [--data]
pnpm cli deliveries [--status pending|sent|dead] [--limit 20] | deliveries retry <id>
pnpm cli dev-seed [--webhook <url>]
```

出口类型与各自怎么拿凭据：[`channels.md`](./channels.md)。

---

## 6. 凭据与安全

- 明文只存一份：密钥库里是 AES-256-GCM 密文，主密钥在数据目录的 `master.key`（600）。
- 出口/监控程序里**只写凭据名**，不写值；中心在发送/拉起时按名解析。
- 解析优先级：**加密密钥库 → 同名环境变量 → `NOTIFY_SECRET_<名字>`**。
- **`master.key` 丢了，库里的凭据就解不开**——备份必须带上它（`pnpm cli backup` 会自动带）。

模型 / 端口等环境变量放 `~/.config/notify-hub/env`（`pnpm start` 与 systemd 都会读）。

---

## 7. 常驻与运维

```sh
mkdir -p ~/.config/systemd/user
cp deploy/notify-hub.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now notify-hub
loginctl enable-linger "$USER"          # 未登录也保持运行
journalctl --user -u notify-hub -f

pnpm cli backup --to ~/backups/notify-hub-$(date +%F)
tools/e2e-resend.sh                     # 自检：出口失败 → 退避重试 → 最终送达
```

---

## 8. 行为要点（别被吓到）

| 现象 | 解释 |
|---|---|
| 同一条事件只提醒一次 | 去重键在有效期内只处理一次（默认 24h） |
| 偶尔收到重复 | 崩溃补发保证**至少一次**，极端情况会重发一遍（出口带幂等头可用于下游去重） |
| 出口挂了，消息没丢 | 落库后重试，退避到 6 小时，超 8 次进死信（`deliveries retry <id>` 手动重试） |
| 中心重启后补发 | 启动时把"发到一半"的投递重置并重发 |
| 托管程序崩了 | 自动退避重启；日志在 `data/producers/<slug>/hub.log` |
| 删了目录程序还在 | 跑一次 `pnpm cli monitor sync` 就会清掉 |
