/**
 * 给 agent 看的最小契约（MCP resource 与 `notifs contract` 共用这一份）。
 *
 * 不用 zod 校验，纯文本；完整版仍在仓库的 docs/producer-protocol.md。
 */
export const PRODUCER_PROTOCOL = `# notifs 接入契约

## 发一条事件

    POST /api/v1/events
    Authorization: Bearer <token>
    Content-Type: application/json

    {"type":"experiment.finished","text":"<给人看的正文>"}

只有 type 和 text 必填。未知字段会被 400 拒绝。可选：
title, url, severity(info|warn|critical), dedup_key, at, data。

返回：202 {accepted,deduplicated,dispatches,event_ids}。
deduplicated:true 也算成功，不要重试。

## type

点分层级，从大到小：<领域>.<对象>.<动作>，如 disk.low、github.pr.reply。
规则的 when.type 支持 * 通配（disk.*、*.error）。

## dedup_key

默认按 (源, type, text) 去重 24 小时。
能判定"同一件事"时必须显式给稳定且唯一的 key：

  一次评论        pr:123:comment:456
  一次提交        pr:123:sha:abc123
  某次周期任务    schedule:9:2026-10-12T08:00Z
  实验进度点      train:<runId>:epoch:100

要点：同一件事稳定、不同事不同。别用随机值（会重复提醒），
也别用固定值（会永远不再提醒）。

## 读（可选）

    GET /api/v1/events?limit=20&type=...
    GET /api/v1/deliveries?limit=20&status=sent|pending|dead
    GET /api/v1/status

都用同一个 Bearer token，且只能看到自己这个源的东西。

## 托管程序（可选）

不想自己管进程，就让 notifs 托管。目录 producers/<slug>/producer.json：

    {
      "name": "显示名",
      "slug": "my-watch",
      "kind": "managed",
      "command": ["node", "index.mjs"],
      "credentials": ["SOME_TOKEN"],
      "config": {}
    }

中心会注入这些环境变量：

    NOTIFY_BASE_URL      中心地址
    NOTIFY_TOKEN         你的 source token
    NOTIFY_PRODUCER_ID   心跳用的 id
    NOTIFY_STATE_DIR     你独占的状态目录（存游标/登录态）
    NOTIFY_CONFIG        producer.json 里的 config（JSON 字符串）

约定：
1. 每 30s POST {NOTIFY_BASE_URL}/api/v1/producers/{NOTIFY_PRODUCER_ID}/heartbeat
   带 {"status":"ok"}；异常用 {"status":"degraded","detail":"..."}，别静默。
2. 断点写进 NOTIFY_STATE_DIR，重启要能续上。
3. 退出码 0 = 正常结束（不再重启）；非 0 = 异常（退避重启）。
4. 不要硬编码密钥；在 credentials 里声明，值用 \`notifs secret set <名>\` 存。
5. 一次 POST 最多 100 条。

## 声明式 poller（不写代码）

producer.json 里 kind=poller，poller 字段：

    {
      "interval": "60s",
      "request": { "url": "...", "method": "GET",
                   "headers": { "Authorization": "Bearer {{secrets.NAME}}" } },
      "extract": "$[*]",
      "key": "$.id",
      "change": { "on": "new_item" },
      "map": { "type": "\"app.changed\"", "text": "$.title",
               "dedup_key": "\"item:{{ id }}\"" }
    }

change.on: new_item | field_changed | threshold。
map 取值：$ = 整个条目；$.a.b = 取路径；"字面量" = 常量；
"x{{ 表达式 }}y" = 字面量内插值。

## 命令

    notifs watcher init <slug>      生成托管程序骨架
    notifs watcher check <slug>     静态校验
    notifs watcher try <slug>       试运行（只打印会上报什么）
    notifs watcher enable <slug>    上线
    notifs watcher logs <slug>      日志
`;
