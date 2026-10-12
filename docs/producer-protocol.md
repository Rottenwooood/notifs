# 监控程序接入规范（Producer Protocol）

> 本规范是 **手写监控程序的说明书**，也是 **agent 生成监控程序的唯一输入契约**（见
> `技术方案.md` §5.3 / §5.4）。规范越清晰，agent 生成质量越高。
>
> 一句话：**监控程序只负责"发现变化 + 按格式上报"**，其余（去重、路由、节流、投递、
> 重试、补发）全部由 notify-hub 中心负责。你不需要碰任何下游逻辑。

---

## 1. 什么是"监控程序"

任何能发现某个信息源发生变化、并把变化推给 notify-hub 的东西。它可以是：

- 一段几十行的 Node / Python 脚本；
- 一个已有的 webhook（如 GitHub）；
- 一段声明式轮询配置（不用写代码）。

中心对它们一视同仁：**产出的都是同一种事件信封**。

---

## 2. 三种接入形态

| 形态 | 适用场景 | 谁来运行 | 怎么接入 |
|---|---|---|---|
| **Push** | 源自带 webhook（GitHub、告警系统等） | 源自己 | 直接 `POST /api/v1/events` |
| **Managed** | 需要写代码：登录态页面、复杂判定、需要本机环境 | 中心托管 | 遵守本文第 4–5 节，中心启动它 |
| **Poller** | 简单 HTTP 源，不想写程序 | 中心内建 | 一段配置（第 6 节） |

选择建议：**有 webhook → Push；简单 HTTP + 字段变化 → Poller；其余（登录态/复杂逻辑）→ Managed。**

---

## 3. 事件信封（唯一公共语言）

**只有 `type` 和 `text` 必填**，其余可选。**未知字段会被拒绝**（strict）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | 事件类型，规则匹配的主依据。用点分层级，如 `github.pr.reply` |
| `text` | ✅ | 给人看的正文。**可以是一句话，也可以是整篇正文** |
| `source` | | 来源标识；不填则用 token 绑定的源 |
| `title` | | 通知标题 |
| `url` | | 主链接，点通知可跳转 |
| `severity` | | `info`(默认) / `warn` / `critical` |
| `dedup_key` | | 去重键。**能判定"同一件事"时必须给**，见下 |
| `at` | | 事件发生时间（ISO8601）；默认 = 接收时间 |
| `data` | | 结构化附加数据（对象），规则/模板可按路径取用 |

### `dedup_key` —— 最重要的一条

中心用 `(source, dedup_key)` 做幂等：**同一 key 在 TTL（默认 24h）内只处理一次**。

- **不要交给系统派生。** 不填时系统按 `(source, type, text)` 哈希去重，只适合"内容相同即同一件事"的简单场景。
- **监控程序能判定变化时，必须显式给稳定且唯一的 key**：
  - 一条评论 → `pr:123:comment:456`
  - 一次提交 → `pr:123:sha:abc123`
  - 周期任务某次触发 → `schedule:9:2026-10-12T08:00Z`
- **key 要"同一件事稳定、不同事不同"**。用递增 id / sha / 时间戳组成，别用随机值（会每次重复提醒），也别只用固定前缀（会永远不再提醒）。

### 示例

一句话提醒：

```json
{ "type": "github.pr.reply", "text": "PR 那边回复了" }
```

带完整正文：

```json
{
  "type": "github.pr.reply",
  "title": "PR #123 有新回复",
  "text": "Alice: 这个改动我看过了，麻烦补个测试。",
  "url": "https://github.com/o/r/pull/123#issuecomment-456",
  "severity": "info",
  "dedup_key": "pr:123:comment:456",
  "data": { "repo": "o/r", "pr": 123, "author": "Alice" }
}
```

---

## 4. HTTP 接口

### 4.1 上报事件

```http
POST /api/v1/events
Authorization: Bearer <source-token>
Content-Type: application/json
```

- body：**单条信封，或信封数组（≤ 100 条，逐条处理、允许部分成功）**。
- 单条响应 `202`：

```json
{ "accepted": true, "deduplicated": false, "event_ids": ["01M4..."], "dispatches": 2 }
```

- 数组响应 `202`：

```json
{ "accepted": 2, "deduplicated": 1, "event_ids": ["01M4...", "01M4..."], "errors": ["type: Required"] }
```

- 去重命中时 `deduplicated: true` 且 `event_ids` 为空 —— **这是成功，不是错误**，无需重试。
- 错误码：`400`（信封非法，附逐字段错误）/ `401`（token 错）/ `403`（源被禁用）/ `413`（body > 1MB）。

### 4.2 心跳（仅 Managed）

```http
POST /api/v1/producers/<producer-id>/heartbeat
Authorization: Bearer <source-token>

{ "status": "ok" | "degraded" | "error", "detail": "可选说明", "cursor": "可选进度游标" }
```

- **每 30s 一次**。中心超过 90s 收不到心跳会认为进程卡死并重启它。
- 任何异常（登录态失效、页面结构变了、被风控）都要用 `degraded`/`error` + `detail` 上报出来，**不要静默**。中心会据此提醒你。

### 4.3 上报状态 / 游标（可选）

```http
POST /api/v1/producers/<producer-id>/state
{ "detail": "已处理到 2026-10-12T08:00Z", "cursor": "..." }
```

仅用于在 UI 展示"监控到哪了"。**真正的断点续传由你自己在 `NOTIFY_STATE_DIR` 里持久化**。

---

## 5. Managed 监控程序约定

每个 managed 程序是一个目录，含一个 `producer.json` 清单加代码：

```json
{
  "name": "GitHub PR 回复监控",
  "slug": "github-pr",
  "kind": "managed",
  "description": "轮询指定 PR 的评论，有新评论就上报",
  "enabled": true,
  "interval": "60s",
  "credentials": ["GITHUB_TOKEN"],
  "command": ["node", "index.mjs"],
  "config": { "repo": "o/r", "pr": 123 }
}
```

| 字段 | 说明 |
|---|---|
| `slug` | 唯一标识；目录名、source 名都用它 |
| `kind` | `managed` 或 `poller` |
| `enabled` | 首次登记是否启用，默认 `true`；样板建议 `false` |
| `credentials` | 需要中心注入的凭据名（见下） |
| `config` | 你的自定义配置，中心**原样**通过 `NOTIFY_CONFIG` 注入 |
| `command` | 启动命令 |

中心用以下环境变量启动你的程序，你按约定读写即可：

| 环境变量 | 含义 |
|---|---|
| `NOTIFY_BASE_URL` | 中心地址，如 `http://127.0.0.1:7710` |
| `NOTIFY_TOKEN` | 你的 source token（用于鉴权） |
| `NOTIFY_PRODUCER_ID` | 你的 producer id（心跳路径用） |
| `NOTIFY_STATE_DIR` | **你独占**的持久化目录（存游标、cookie、缓存） |
| `NOTIFY_CONFIG` | 本程序的自定义配置（JSON 字符串） |

**约定：**

1. **报事件**：`POST {NOTIFY_BASE_URL}/api/v1/events`（信封或数组）。
2. **报心跳**：每 30s 一次（第 4.2 节）。
3. **存状态**：自己的游标/登录态写到 `NOTIFY_STATE_DIR`，中心不替你做断点续传。
4. **退出码**：`0` = 正常结束（中心不再重启）；非 `0` = 异常（中心按指数退避重启）。
5. **凭据**：不要硬编码密钥。需要什么在 `producer.json` 的 `credentials` 里**声明**，
   中心从自己的环境取**同名变量**或 `NOTIFY_SECRET_<NAME>` 注入给你（如 `GITHUB_TOKEN`）。
6. **失败要上报**：抓不到页面、登录态失效等，用 `degraded/error` 心跳暴露，别沉默。

---

## 6. Poller 配置（不写代码）

Poller 是一段**声明式配置**，放在清单的 `poller` 字段里：

```yaml
kind: poller
interval: 60s
request:
  url: https://api.github.com/repos/o/r/issues/123/comments
  headers: { Authorization: "Bearer {{secrets.GITHUB_TOKEN}}" }
  conditional: { etag: true }        # 支持 304 短路，省配额
extract: "$[*]"                       # 响应 → 候选条目数组
key:     "$.id"                       # 条目的稳定标识
change:  { on: new_item }             # 什么算变化：new_item / field_changed / threshold
map:                                  # 条目 → 信封字段
  type:      '"github.pr.reply"'      # 加引号 = 字面量
  text:      $.body                   # 不加引号 = 取值（jmespath）
  title:     "PR 新回复"
  url:       $.html_url
  dedup_key: '"pr:123:comment:{{ id }}"'   # 字面量 + {{ }} 插值
  at:        $.created_at
  data:      $                        # 整个条目
```

**`map` 取值语义**（四选一，别写错）：

| 写法 | 含义 |
|---|---|
| `$` | 整个条目对象（给 `data` 用） |
| `$.a.b` 或 `a.b` | jmespath 取值（给 `text`/`url`/`at` 用） |
| `"字面量"` / `'字面量'` | 字符串字面量（给 `type`/`title` 用） |
| `"x{{ 表达式 }}y"` | 字面量内插值（给 `dedup_key` 用） |

**变化判定 `change.on`：**

- `new_item`：条目 key 以前没见过 → 上报。
- `field_changed`：`change.field` 的值与上次不同 → 上报。
- `threshold`：`change.field` 的数值满足 `op`/`value`（如 `lt 100`）且**上次不满足** → 上报（边沿触发）。

中心侧行为：加条件请求 → 取条目 → 与上次快照比对 → 命中变化才生成事件 → 更新快照。
**请求失败时不更新快照**（避免丢事件或误判）；**单条映射失败只跳过该条并记录**，不拖垮整轮。

---

## 7. 最小示例（Node，Managed）

```js
// producers/github-pr/index.mjs
const BASE = process.env.NOTIFY_BASE_URL;
const TOKEN = process.env.NOTIFY_TOKEN;
const ID = process.env.NOTIFY_PRODUCER_ID;
const STATE = process.env.NOTIFY_STATE_DIR;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const heartbeat = () =>
  setInterval(() => post(`/api/v1/producers/${ID}/heartbeat`, { status: 'ok' }).catch(() => {}), 30_000);

async function main() {
  heartbeat();
  // 1) 从你的源取数据（省略：读 STATE 里的游标、调 API、比对快照）
  // 2) 发现变化后上报
  await post('/api/v1/events', {
    type: 'github.pr.reply',
    title: 'PR #123 有新回复',
    text: 'Alice: 麻烦补个测试。',
    url: 'https://github.com/o/r/pull/123#issuecomment-456',
    dedup_key: 'pr:123:comment:456',
    data: { repo: 'o/r', pr: 123, author: 'Alice' },
  });
}

main().catch(async (err) => {
  await post(`/api/v1/producers/${ID}/heartbeat`, { status: 'error', detail: String(err) }).catch(() => {});
  process.exit(1); // 非 0 → 中心会重启
});
```

---

## 8. 检查清单（写完自查）

- [ ] 事件有 `type` 和 `text`，且没有多余字段（会被 strict 拒绝）。
- [ ] 每条"可判定为变化"的事件都有**稳定且唯一**的 `dedup_key`。
- [ ] 每 30s 发一次心跳。
- [ ] 游标/登录态写在 `NOTIFY_STATE_DIR`，重启后能续上。
- [ ] 异常用 `degraded/error` 心跳上报，不静默。
- [ ] 不硬编码密钥；需要的凭据记在 `producer.json` 里声明。
- [ ] 正常结束 `exit 0`，异常 `exit 非0`。

---

## 9. 常见错误

| 症状 | 原因 |
|---|---|
| 每次都重复提醒 | `dedup_key` 不稳定（用了随机值/时间戳，而事件本身没变） |
| 只提醒一次，之后再也不提醒 | `dedup_key` 是固定值（同一 key 永远被去重） |
| 400 且提示未知字段 | 信封里带了规范外的字段（strict） |
| 一直收不到通知 | 没有匹配的**规则**（规则才决定往哪个 channel 发） |
| 中心一直重启你的程序 | 非 0 退出 / 心跳超时 / 心跳没发 |
