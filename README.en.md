<div align="center">

# notifs

[简体中文](README.md) · English

**A self-hosted subscription messaging hub for people, programs and AI agents.**

**Compatibility:** adapted to OpenCode `2.x` & MCP (`@modelcontextprotocol/sdk`).

![CI](https://img.shields.io/github/actions/workflow/status/Rottenwooood/notifs/ci.yml?branch=main&label=CI) ![License](https://img.shields.io/badge/license-MIT-blue) ![npm version](https://img.shields.io/npm/v/notifs) ![npm downloads](https://img.shields.io/npm/dw/notifs) ![Version](https://img.shields.io/github/v/tag/Rottenwooood/notifs?label=version) ![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

---
</div>

`notifs` treats people, programs and AI agents as peer communication nodes. Any participant holding an identity token can publish a `{ type, content }` message one-way; the hub persists it, batches and rate-limits it per subscriber, and actively pushes it to the target adapter according to subscription rules.

The core deliberately has no team roles, task flows or session locks. Every collaboration topology is assembled freely from three pieces: **identity + endpoint + subscription**.

```text
person / program / agent ── HTTP · Unix IPC · MCP ──→ identity auth & publish (type + content)
                                                          │
                                                   subscription match & durable queue
                                                          │
                                              per-target batching · rate limit · push
                                                          ↓
                                  program webhook  /  agent host non-user channel  /  human channels

```

## Core features

* **One-way messaging and arbitrary topologies**: every participant uses fire-and-forget publishing — sending ends the current turn, with no synchronous wait. Composing subscription rules is enough to build "agent posts to Feishu", "Feishu drives a two-way agent conversation", "agent silently watches program events", "agents message each other directly", or a master/worker layout where humans talk only to the coordinator agent, which schedules its sub-agents.
* **AI-native integration boundary**:
  * **Hub → agent**: context is injected through host-specific non-`user_prompt` interfaces (e.g. OpenCode `/synthetic`), and marked with `<agent-messages>` as untrusted data, so prompt injection is isolated at the boundary.
  * **Agent → hub**: agents publish explicitly through MCP `send` or HTTP/IPC; the hub never parses model output or reasoning traces.
* **Dynamic topology orchestration**: a manager agent holding `--manager` credentials can create identities, register endpoints and rewrite subscriptions through MCP tools, arranging the division of labour and the communication paths of its sub-agents itself.

* **Faithful core, rendering at the edge**: the core keeps the original JSON structure end to end and controls batching (`max_wait_ms`, `max_messages`, `max_bytes`) and pacing (`min_interval_ms`) per target independently. Programs receive the full structured batch, agents receive one merged context injection, and human channels render notification cards or text inside the adapter.
* **Symmetric, extensible adapter model**: adding a platform or a custom front end means writing an inbound publish bridge (event → `send`) or registering an outbound deliverer (batch → delivery); routing and storage stay untouched.
* **Single-node durability**: messages and each target's delivery responsibility are written atomically to SQLite WAL. The hub itself drives lease renewal, retry, held and resume states, and supports online hot backup plus automatic cleanup of expired messages.

## Quick start

### Install and run

Install globally from npm:

```sh
npm install -g notifs
notifs init
notifs start

```

Or build and run from source:

```sh
pnpm install && pnpm build
node dist/cli.mjs init
node dist/cli.mjs start

```

A systemd user service keeps it running:

```sh
notifs service install
systemctl --user daemon-reload
systemctl --user enable --now notifs

```

### Assemble a channel in 30 seconds

`notifs init` creates the root controller credential (identity `owner` by default). The following creates a worker identity, binds a webhook receiver, routes messages to it and publishes one:

```sh
# 1. A normal identity, plus a manager identity allowed to orchestrate topology
notifs identity add worker
notifs identity add coordinator --manager

# 2. Give the worker a receiving endpoint (webhook adapter)
notifs endpoint put --config '{
  "name": "worker-hook",
  "owner": "worker",
  "delivery": {
    "kind": "webhook",
    "config": { "url": "http://127.0.0.1:9000/messages" }
  }
}'

# 3. Route messages of type job.* published by owner to worker-hook
notifs subscription put --config '{
  "name": "dispatch-jobs",
  "endpoint": "worker-hook",
  "source": "owner",
  "type": "job.*"
}'

# 4. Publish one-way (plain text or any JSON structure)
notifs message send --type job.compile --content '{"repo":"notifs","branch":"main"}'

```

## Common topologies

Adjusting `endpoint` and `subscription` (glob `source`/`type`, plus field-level `eq`/`ne`/`in`/`exists`/`gt`/`lt` filters over `content`) covers arbitrary workflows:

| Pattern | How to wire it |
| --- | --- |
| **Task completion notice** | an agent or script calls `send` → subscription matches `type="report"` → delivered to `feishu` / `bark` / `ntfy` |
| **Human steers an agent** | `notifs-feishu-inbound` listens to group/@ messages and publishes `human.message` → delivered to an `opencode` session; the agent answers with `reply` or `question` through MCP `send` → delivered to `feishu-app` |
| **Event-driven guard** | a monitor publishes system metrics continuously → subscription condition `stats.failed > 0` → only wakes the repair agent on failure |
| **Master/worker orchestration** | humans talk to a coordinator agent (holding `--manager`) → that agent calls MCP `set_subscription` to wire sub-agents together, then reports back |

## Integration matrix

### Inbound (publish and manage)

All inbound paths share one identity model, one idempotency contract (`Idempotency-Key`) and one subscription router. The optional `to` parameter narrows the matched targets; it never bypasses subscriptions.

* **HTTP API**: `POST /api/messages` with `Authorization: Bearer <token>`.
* **Unix socket IPC**: low-latency local channel (default `notifs.sock`); the CLI and MCP both accept `--socket`.
* **MCP server**: run `notifs mcp`. Every identity gets `send` and `inspect`; manager identities also get `create_identity`, `set_endpoint`, `set_subscription` and the rest of the orchestration tools.
* **Platform bridge**: the separate `notifs-feishu-inbound` process supports Feishu long connections (no public IP required) and HTTP callbacks; it filters irrelevant group traffic and publishes `human.message` with an idempotency key.

### Outbound (delivery adapters)

One identity can own several endpoints, each with its own batching and pacing settings:

* **AI agent hosts**: `opencode` (calls the OpenCode 2.x `/api/session/{id}/synthetic` endpoint; supports `steer` and `queue`).
* **Programs and custom front ends**: `webhook` (POSTs the full JSON batch with a batch `Idempotency-Key`; a 2xx response means taken over).
* **Chat and push channels**: `feishu` (custom bot webhook, signing and @mentions), `feishu-app` (Feishu app bot; direct chats, groups, rich text), `wecom` (WeCom bot), `bark` (iOS push), `ntfy` (self-hosted or hosted push), `local` (Linux `notify-send` with log fallback).

## Documentation

* [Configuration and adapter parameters](docs/configuration.md)
* [MCP integration and orchestration](docs/mcp.md)
* [Agent integration contract](integrations/agent/README.md)
* [Architecture](docs/design/notifs.md) · [Boundaries](docs/boundaries.md) · [Deployment](deploy/README.md)

## License

[MIT](LICENSE)
