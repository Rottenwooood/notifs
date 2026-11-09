# notifs

A local communication hub for **agents, programs and people**.

Anything can POST one event; notifs deduplicates it, matches rules, and fans it out
to your channels. It also hosts your long-running monitor programs, and exposes an
**MCP server** so an agent can notify you without you pasting anything.

```
agent / script / service ──POST──▶ notifs ──▶ desktop / Feishu / ...
                                      │
                              dedup · rules · retry · outbox
```

One process, one SQLite file, binds `127.0.0.1` only.

## Team messaging (v2)

The same process now accepts `{"type":"message","content":...}` for programs,
agents and people. Controller-managed subscriptions choose recipients; HTTP and
local Unix sockets share a durable queue, full-message batching and explicit ack.
Run `notifs help` for `identity`, `endpoint`, `subscription` and `message` commands.
Use `notifs mcp --v2` for the new tools. Existing notification APIs remain available.

[Quick start and delivery semantics](docs/messaging.md).

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

## Ask — send, then wait for a reply

```http
POST /api/v1/ask
Authorization: Bearer <token>
Content-Type: application/json

{"text":"Run the full sweep now?","timeout_minutes":10}
```

```json
202 {"ask_id":"01M...","event_id":"01M...","expires_at":"...","dispatches":1}
```

The notification goes out through the normal rules. When you **quote-reply** that
message in Feishu, the ask gets answered — and the caller gets your words back:

```http
GET /api/v1/ask/01M...?wait=300        # long-poll, server caps `wait` at 600s
```

```json
{"status":"answered","reply":"go ahead, small run first","replied_at":"...","expires_at":"..."}
```

`status` is `pending` → `answered` | `expired`. Default timeout **5 minutes**, max **30**.

Two things to know:

- **You must quote-reply** the notification. A plain message carries no `parent_id`,
  so there is nothing to match it against.
- The reply has to come back over a channel that can *receive*: `feishu-app` plus the
  inbound long-connection producer. A group bot webhook (`feishu`) is send-only.

The MCP tool `ask` does all of this in one call and returns the reply text.

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

## Example producers

Two runnable examples live in the repo — **not in this package**, because a producer is a
program, not library code:

| Directory | What it does | Deps |
|---|---|---|
| [`producers/routine`](https://github.com/Rottenwooood/notifs/tree/main/producers/routine) | time-based reminders | none |
| [`producers/feishu-events`](https://github.com/Rottenwooood/notifs/tree/main/producers/feishu-events) | **receives** Feishu messages (long connection) → acks / `ask` | `@larksuiteoapi/node-sdk` |

```sh
git clone https://github.com/Rottenwooood/notifs.git
cp -r notifs/producers/routine ~/.local/share/notifs/producers/
cd ~/.local/share/notifs/producers/routine && npm install   # only if it declares deps
notifs watcher sync && notifs watcher enable routine
```

> Sending **to** Feishu is not a producer — that's the built-in `feishu` / `feishu-app`
> channel. `feishu-events` only brings messages back (you need it for `ask` and acks).

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

The v1 mode exposes 5 tools — `send`, `ask`, `events`, `deliveries`, `status` — 3 prompts (`write-script`, `write-monitor`,
`poller`) and one resource (`notifs://contract`).

Tools are deliberately **not** able to delete rules or rotate tokens: the blast
radius of a confused agent is "one extra notification".

The v2 mode (`notifs mcp --v2`) exposes `send`, `receive`, `ack`, `inspect`.
Full setup for OpenCode and other MCP clients:
[`docs/mcp.md`](docs/mcp.md).

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
- **v1 has no throttling / quiet hours.** v2 endpoints support batching and trigger intervals.
- **Different feedback semantics.** v1 ask supports Feishu quote-replies; v2 uses explicit batch acknowledgement and has no reply-correlation field.

## 中文文档

- [`docs/mcp.md`](docs/mcp.md) — MCP 配置（opencode / 通用客户端）、5 个工具、prompts 与 resource
- [`docs/remote.md`](docs/remote.md) — 把中继放到服务器（SSH 隧道，不开公网端口）
- [`docs/usage.md`](docs/usage.md) — 运行、保留的 v1 入口与当前能力边界
- [`docs/messaging.md`](docs/messaging.md) — v2 订阅、身份、HTTP/IPC 与批量确认
- [`docs/design/notifs-v2.html`](docs/design/notifs-v2.html) — 简短架构概览
- [`docs/validation/README.md`](docs/validation/README.md) — 阶段外部验收流程与记录
- [`docs/producer-protocol.md`](docs/producer-protocol.md) — 监控程序接入规范（完整版）
- [`docs/channels.md`](docs/channels.md) — 各出口怎么拿凭据

## Development

```sh
pnpm install
pnpm typecheck && pnpm test
pnpm build          # → CLI、server、messaging-worker 与共享 chunks
```

Stage acceptance uses an actual OpenCode Go `opencode-go/deepseek-v4.1-flash`
session against the running service. Unit tests and smoke scripts are supplementary.
See [development rules](AGENTS.md) and [acceptance records](docs/validation/README.md).

## License

MIT
