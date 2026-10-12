# 出口接入指引（手机 / 微信 / 飞书 / 任意 Webhook）

一个**出口** = 一个地址或凭据 + 一段配置 JSON。在管理界面「出口」页新建，或：

```sh
pnpm cli channel add phone --kind ntfy --config '{"topic":"my-topic"}'
```

配好出口后，还要有一条**规则**把事件发到它（规则里 `actions[].channel` 填出口名）。

---

## 手机

### ntfy（Android/iOS/桌面都行，可自建）

1. 手机装 **ntfy** App；
2. 想一个别人猜不到的 topic 名（如 `nh-7f3a91`），在 App 里点「Subscribe」订阅它；
3. 配置：

```json
{ "topic": "nh-7f3a91" }
```

自建服务器时加 `"server": "https://ntfy.example.com"`；若服务器要求鉴权再加 `"token": "..."`。

### Bark（仅 iOS，最简单）

1. App Store 装 **Bark**；
2. 打开 App，首页那串地址形如 `https://api.day.app/XXXXXXXX`，`XXXXXXXX` 就是你的 key；
3. 配置：

```json
{ "key": "XXXXXXXX" }
```

可选：`{"key":"...","group":"notify-hub","level":"timeSensitive"}`。

---

## 微信

个人微信**没有**官方接口，用第三方协议库直连会被封号。官方途径是**企业微信机器人**。

1. 企业微信里建一个群（可以只有你自己）→ 群设置 → **群机器人** → 添加；
2. 复制它的 Webhook 地址，形如
   `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd-1234-...`；
3. 取 `key=` 后面那段，配置：

```json
{ "webhookKey": "abcd-1234-..." }
```

想 @ 人：`{"webhookKey":"...","mentionedList":["@all"]}`。
企业微信有频率限制（约 20 条/分钟），被限流时中心会自动重试。

---

## 飞书

1. 飞书群里 → 右上角设置 → **群机器人** → 添加机器人 → **自定义机器人**；
2. 复制 Webhook 地址，形如
   `https://open.feishu.cn/open-apis/bot/v2/hook/1a2b3c-...`；
3. 配置（直接把整段地址填进 `webhook`）：

```json
{ "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/1a2b3c-..." }
```

**如果建机器人时勾了「签名校验」**，把密钥一起填上（不填会返回 `19021 签名错误`）：

```json
{ "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/...", "secret": "你的签名密钥" }
```

可选：

- 富文本（标题 + 正文 + 链接）：`{"msgType": "post"}`
- @ 所有人：`{"mentions": ["all"]}`
- @ 指定人：`{"mentions": ["ou_xxxxxxxx"]}`（要 open_id，不是昵称）
- 国际版 Lark 把 webhook 换成 `open.larksuite.com` 域名即可（也支持只填末段 token）

---

## 任意 Webhook（兜底）

任何能收 HTTP 的端点都能当出口：

```json
{
  "url": "https://your-service.example.com/notify",
  "method": "POST",
  "headers": { "x-token": "..." },
  "bodyTemplate": "{\"text\":\"{{title}}: {{body}}\"}"
}
```

默认会把 `{title, body, markdown, url, severity, event_id}` 作为 JSON 发出，并带一个
幂等头 `x-notify-idempotency-key`（重试时值不变，便于下游去重）。

---

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 飞书报 `19021 签名错误` | 机器人开了签名校验，但配置里没填 `secret` |
| 飞书 @ 不生效 | `mentions` 要填 open_id（`ou_...`），不是昵称；@ 所有人用 `"all"` |
| 企业微信被限流 | 约 20 条/分钟；被限流会自动重试，调低事件频率或加聚合 |
| ntfy 收不到 | topic 拼错、或自建服务器需要 `server` / `token` |
| 配了出口却没通知 | 缺**规则**：事件要先被某条规则匹配，`actions[].channel` 指到该出口 |
