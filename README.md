# notifs

A tiny local notification relay for **agents, scripts and humans**.

Anything can POST one event; notifs deduplicates it, matches rules, and fans it out
to your channels. It also hosts your long-running monitor programs, and exposes an
**MCP server** so an agent can notify you without you pasting anything.

```
agent / script / service ──POST──▶ notifs ──▶ desktop / Feishu / ...
                                      │
                              dedup · rules · retry · outbox
```

One process, one SQLite file, binds `127.0.0.1` only.

## Install

```sh
npm i -g notifs

notifs init                 # 建数据目录 + 一个 agent token（~/.config/notifs/token）
notifs channel add desktop --kind local --config '{}'
notifs rule add --name all --when '{}' --actions '[{"channel":"desktop"}]'
notifs notify "hello"
notifs install-service      # systemd 用户服务 + 开机自启
```

## The whole contract

```http
POST http://127.0.0.1:7710/api/v1/events
Authorization: Bearer <token>        # ~/.config/notifs/token
Content-Type: application/json

{"type":"experiment.finished","text":"loss 2.10→0.83 · 3h12m · ~/models/x.pt"}
```

Only `type` and `text` are required. Unknown fields are rejected (strict).
Returns `202 {accepted,deduplicated,dispatches,event_ids}` — `deduplicated:true` is
also success, don't retry.

`type` is dotted and hierarchical (`disk.low`, `github.pr.reply`); rules match it with
`*` globs. Give an explicit `dedup_key` whenever you can decide "this is the same
thing" — e.g. `train:<runId>:epoch:100` (include the *run* id, or a re-run will never
notify again).

Full contract: `notifs contract`.

## Three ways to write a producer

| | when | how |
|---|---|---|
| **Script** | you already have cron/systemd, or it's 20 lines | just POST. No SDK, no registration beyond a token |
| **Managed** | you want notifs to own the process | `notifs watcher init <slug>` → fill `producer.json` + `index.mjs` → `watcher check/try/enable` |
| **Poller** | plain HTTP + "new item / field changed / threshold" | `notifs watcher init <slug> --kind poller`, fill the `poller` field, no code |

Managed producers get: auto-start, 30s heartbeat, crash backoff-restart, encrypted
credential injection, log capture under the data dir.

> **The honest trade-off:** a script nobody supervises can die silently — you just
> stop getting notifications, and "no notification" is indistinguishable from
> "nothing happened". That's why managed mode exists.

## MCP

```jsonc
{
  "mcp": {
    "notifs": {
      "type": "local",
      "command": ["notifs", "mcp"],
      "environment": { "NOTIFY_BASE_URL": "http://127.0.0.1:7710" }
    }
  }
}
```

Exposes 4 tools — `send`, `events`, `deliveries`, `status` (the last answers
"did it actually reach my phone?") — 3 prompts (`write-script`, `write-monitor`,
`poller`) and one resource (`notifs://contract`).

Tools are deliberately **not** able to delete rules or rotate tokens: the blast
radius of a confused agent is "one extra notification".

## Channels

| kind | status |
|---|---|
| `local` | **maintained** — Linux desktop notifications |
| `feishu` | **maintained** — Feishu group bot webhook |
| `feishu-app` | **maintained** — Feishu app bot (DM or group) |
| `ntfy` `bark` `wecom` `webhook` | in the code, **untested** — no promises |

## Known limits

- **At-least-once delivery.** Crash recovery can resend; messages carry `event_id` for downstream dedup.
- **No public ingress.** Binds `127.0.0.1`; remote senders need a proxy or a different bind.
- **`at` is a timestamp label, not a scheduler.** There is no built-in cron. Time-based reminders are just a producer that watches the clock.
- **No throttling / quiet hours yet.** Rate-limit on the producer side.
- **No feedback loop.** Notifications are one-way; there's no ack/button round-trip.

## 中文文档

- [`docs/使用手册.md`](docs/使用手册.md) — CLI 全量用法、托管/不托管/轮询三种写法、可直接交给 agent 的提示词
- [`docs/producer-protocol.md`](docs/producer-protocol.md) — 监控程序接入规范（完整版）
- [`docs/channels.md`](docs/channels.md) — 各出口怎么拿凭据

## Development

```sh
pnpm install
pnpm typecheck && pnpm test
pnpm build          # → dist/cli.mjs, dist/server.mjs（esbuild 单文件，只外置 better-sqlite3）
```

## License

MIT
