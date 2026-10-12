# 上手：怎么用 notify-hub

## 0. 一分钟理解

它就是一条**事件管道**：

```
源（发现变化） → 中心（去重 · 规则匹配） → 出口（弹通知）
```

你实际要做的永远只有三件事：**建出口 → 建规则 → 接一个源**。其余（去重、重试、补发、托管）中心自己管。

---

## 1. 启动与登录

```sh
cd ~/dev/notify-hub
pnpm start                 # 前台启动（Ctrl-C 停）；会自动读 ~/.config/notify-hub/env
# 或正式常驻：见第 7 节 systemd
```

浏览器打开 **http://127.0.0.1:7710/**，用中心里的用户登录。第一次要先建用户：

```sh
pnpm cli user init --username admin --password '<口令>'
```

---

## 2. 最小可用路径（5 分钟跑通一条提醒）

**① 建一个出口**（界面「出口」页，或命令行）

```sh
# 桌面系统通知（本机）
pnpm cli channel add desktop --kind local --config '{}'
```

**② 建一条规则**（界面「规则」页）——规则决定"要不要发、发到哪"

```sh
# 匹配所有事件，发给 desktop 出口
pnpm cli rule add --name '全部 → 桌面' --when '{}' --actions '[{"channel":"desktop"}]'
```

**③ 发一条测试事件**

```sh
TOKEN=$(pnpm cli source add cli | grep -o '"token": "[^"]*"' | cut -d'"' -f4)
pnpm cli emit --server http://127.0.0.1:7710 --token "$TOKEN" \
  --type demo.hello --text '你好 notify-hub'
```

桌面应该弹出通知；界面「投递记录」里能看到一条 `sent`。

> **最常见的坑**：只建了出口、没建规则 → 不会有任何通知。出口是"通往哪"，规则是"什么情况走它"。

---

## 3. 接一个源（三种形态，按情况选）

| 形态 | 什么时候用 | 怎么做 |
|---|---|---|
| **Push** | 对方自带 webhook（GitHub、告警系统…） | 界面「信息源」建一个 → 复制 token → 填进对方；对方 `POST /api/v1/events` |
| **Poller** | 简单的 HTTP 接口，只是按字段变化判断 | 写一份 `producer.json`（纯配置，不写代码）放进 `producers/` |
| **Managed** | 要写代码（登录态页面、复杂逻辑） | 写个小程序放进 `producers/<slug>/`，中心负责拉起/重启/心跳 |

三种产出的**信封格式完全一样**；区别只是"判定变化的逻辑跑在哪"。

信封只有两个字段必填：

```json
{ "type": "github.pr.reply", "text": "PR 那边回复了" }
```

可选：`title` / `url` / `severity` / `dedup_key` / `at` / `data`。
**能被判定为"变化"的事件必须给稳定的 `dedup_key`**（否则会重复提醒或永不提醒）。详见
[`producer-protocol.md`](./producer-protocol.md)。

### 放一个监控程序进去

```sh
# 写好 producers/my-watch/{producer.json,index.mjs}
pnpm cli producer sync        # 扫描目录 → 登记
pnpm cli producer list        # 看状态/pid/重启次数
pnpm cli producer logs my-watch
```

**目录监听**：中心运行中，往 `producers/` 放目录会**立刻生效**，不用重启。

---

## 4. 让 agent 生成监控程序

需要先在中心的环境里配好模型（见第 6 节的 env 文件），然后：

```sh
pnpm cli author new "监控 <某地址>，有变化就通知我"   # 生成草稿（信息不足会先反问）
pnpm cli author show <slug>                          # 看代码 / README
pnpm cli author try  <slug> --seconds 15             # 试运行：只打印"将会上报的事件"
pnpm cli author approve <slug>                       # 审核通过 → 自动上线
```

界面上「Agent 生成」页有同样的流程，且**审批是硬门槛**，不会自动上线。

---

## 5. 常用命令速查

```sh
# 源 / 出口 / 规则
pnpm cli source  add <名字> | list
pnpm cli channel add <名字> --kind <类型> --config '<json>'
pnpm cli rule    add --name <名字> --when '<json>' --actions '<json>' | list

# 发一条事件 / 看投递
pnpm cli emit --server <地址> --token <token> --type <类型> --text <正文>
pnpm cli deliveries

# 监控程序
pnpm cli producer sync | list | enable <slug> | disable <slug> | logs <slug>

# Agent
pnpm cli author new | list | show | check | try | approve | reject

# 密钥与运维
pnpm cli secret set <名字> [--value <值>]   # 不写 --value 则从 stdin 读，避免进 shell 历史
pnpm cli secret list | rm <名字>
pnpm cli llm check                          # 探测模型端点
pnpm cli backup [--to <目录>]               # 数据库快照 + 主密钥
```

出口类型：`local`（桌面）· `webhook`（任意 HTTP）· `ntfy` · `bark` ·
`wecom`（企业微信）· `feishu`（群自定义机器人）· `feishu-app`（飞书应用机器人）。
每种怎么拿凭据见 [`channels.md`](./channels.md)。

---

## 6. 凭据与安全

- **明文只存一份**：密钥库里是 AES-256-GCM 密文，主密钥在数据目录的 `master.key`（600）。
- 出口配置里**只写凭据名**（如 `appIdSecret: "FEISHU_APP_ID"`），不写值。
- 监控程序声明 `credentials`，中心在拉起它时注入成环境变量。
- 解析优先级：**加密密钥库 → 同名环境变量 → `NOTIFY_SECRET_<名字>`**。
- **`master.key` 丢了，库里的凭据就解不开**——备份时必须带上它（`pnpm cli backup` 会自动带）。

**模型 / 端口等环境变量**放这里（systemd 也会读）：

```sh
mkdir -p ~/.config/notify-hub
cat > ~/.config/notify-hub/env <<'EOF'
NOTIFY_LLM_MODEL=deepseek-flash
NOTIFY_LLM_BASE_URL=https://api.deepseek.com
NOTIFY_LLM_API_KEY=<key>
EOF
```

---

## 7. 常驻与运维

```sh
mkdir -p ~/.config/systemd/user
cp deploy/notify-hub.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now notify-hub
journalctl --user -u notify-hub -f

pnpm cli backup --to ~/backups/notify-hub-$(date +%F)
tools/e2e-resend.sh        # 自检：出口失败 → 退避重试 → 最终送达
```

---

## 8. 行为要点（别被吓到）

| 现象 | 解释 |
|---|---|
| 同一条事件只发一次 | 去重键在有效期（默认 24h）内只处理一次 |
| 偶尔收到重复 | 崩溃补发保证**至少一次**，极端情况会重发一遍（出口带去重头可用于下游幂等） |
| 出口挂了，消息没丢 | 落库后重试，退避到 6 小时，超 8 次进死信（界面可手动重试） |
| 中心重启后补发 | 启动时把"发到一半"的投递重置并重发 |
| 程序崩了 | 托管程序自动退避重启；日志在 `data/producers/<slug>/hub.log` |
